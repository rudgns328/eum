/**
 * 설계서 8.3 — 파싱 정확도 측정.
 *
 * 실 API를 호출한다. npm test에는 넣지 않는다(느리고 비용이 든다).
 *   PARSE_SAMPLES_DIR=/path/to/samples npm run measure:parse
 *
 * 샘플과 정답지는 저장소 밖에 둔다. 측정에 쓰는 문서에 개인정보가 없더라도
 * 이미지가 저장소에 들어갈 이유가 없다(CLAUDE.md 절대규칙 4).
 *
 * 정답지는 문서를 보고 손으로 적는다. 모델 출력을 베껴 오면 측정이
 * 자기충족이 된다 — 시나리오 35건 때와 같은 원칙이다.
 *
 * 샘플 디렉터리 구조
 *   fss_01.png            문서 이미지 (png/jpg/pdf)
 *   fss_01.answer.json    정답지
 */

import { readFileSync, readdirSync } from 'node:fs';
import { extname, join } from 'node:path';

import { expect, it } from 'vitest';

import { parseDocument, type ParseResult } from '@/lib/llm/parse';
import type {
  ParsedDocumentType,
  ParsedFamilyCert,
  ParsedFssQueryResult,
} from '@/lib/llm/schemas';

const MEDIA: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.pdf': 'application/pdf',
};

interface RelationAnswer {
  /** 사람 구분용 라벨. 채점에는 쓰지 않고 결과 표시에만 쓴다 */
  label?: string;
  relation: string | null;
  alive: boolean | null;
  is_minor: boolean | null;
}

interface InstitutionAnswer {
  institution_name: string;
  category: string | null;
  amount: number | null;
}

interface Answer {
  document_type: ParsedDocumentType;
  label: string;
  /** 미성년 판정 기준일. 정답지가 어느 날을 기준으로 적혔는지 명시한다 */
  today?: string;
  note?: string;
  relations?: RelationAnswer[];
  institutions?: InstitutionAnswer[];
}

interface Row {
  file: string;
  label: string;
  status: ParseResult['status'];
  confidence: number | null;
  /** 정답 항목 수 */
  total: number;
  /** 전부 일치한 항목 수 */
  hit: number;
  /** 정답에 없는데 만들어낸 항목 */
  extra: number;
  misses: string[];
}

function normalize(name: string): string {
  return name.replace(/\s|\(주\)|㈜|주식회사/g, '');
}

/** 기관명은 표기 흔들림을 허용한다 — 한쪽이 다른 쪽을 포함하면 같은 기관으로 본다 */
function sameInstitution(a: string, b: string): boolean {
  const x = normalize(a);
  const y = normalize(b);
  return x === y || x.includes(y) || y.includes(x);
}

function scoreFss(parsed: ParsedFssQueryResult, answer: Answer): Omit<Row, 'file' | 'label' | 'status' | 'confidence'> {
  const expected = answer.institutions ?? [];
  const got = [...parsed.institutions];
  const misses: string[] = [];
  let hit = 0;

  for (const want of expected) {
    const index = got.findIndex((g) => sameInstitution(g.institution_name ?? '', want.institution_name));
    if (index === -1) {
      misses.push(`${want.institution_name}: 누락`);
      continue;
    }
    const [row] = got.splice(index, 1);
    const problems: string[] = [];
    if (row.category !== want.category) problems.push(`업권 ${row.category}`);
    if ((row.amount ?? null) !== want.amount) problems.push(`금액 ${row.amount}`);
    if (problems.length === 0) hit += 1;
    else misses.push(`${want.institution_name}: ${problems.join(' / ')}`);
  }

  return { total: expected.length, hit, extra: got.length, misses };
}

function scoreFamily(parsed: ParsedFamilyCert, answer: Answer): Omit<Row, 'file' | 'label' | 'status' | 'confidence'> {
  const expected = answer.relations ?? [];
  const got = [...parsed.relations];
  const misses: string[] = [];
  let hit = 0;

  for (const want of expected) {
    // 같은 관계가 여러 명일 수 있다(자녀 3명). 관계가 같은 후보 중에서
    // 생존·미성년까지 맞는 쪽을 먼저 집어야 짝이 어긋나지 않는다.
    const candidates = got
      .map((g, i) => ({ g, i }))
      .filter(({ g }) => g.relation === want.relation);
    if (candidates.length === 0) {
      misses.push(`${want.relation}: 누락`);
      continue;
    }
    const exact = candidates.find(
      ({ g }) => (g.alive ?? null) === want.alive && (g.is_minor ?? null) === want.is_minor,
    );
    const picked = exact ?? candidates[0];
    const [row] = got.splice(picked.i, 1);
    const problems: string[] = [];
    if ((row.alive ?? null) !== want.alive) problems.push(`생존 ${row.alive}`);
    if ((row.is_minor ?? null) !== want.is_minor) problems.push(`미성년 ${row.is_minor}`);
    // 이름은 마스킹본이어야 한다. 원본이 새어 나오면 오답이다(절대규칙 4).
    if (row.name_masked && !/○/.test(row.name_masked)) problems.push(`마스킹 안 됨 ${row.name_masked}`);
    if (problems.length === 0) hit += 1;
    else misses.push(`${want.label ?? want.relation}: ${problems.join(' / ')}`);
  }

  return { total: expected.length, hit, extra: got.length, misses };
}

it('파싱 정확도 측정', { timeout: 900_000 }, async () => {
  const dir = process.env.PARSE_SAMPLES_DIR;
  expect(dir, 'PARSE_SAMPLES_DIR 필요').toBeTruthy();
  expect(process.env.ANTHROPIC_API_KEY, 'ANTHROPIC_API_KEY 필요').toBeTruthy();

  const answers = readdirSync(dir!).filter((f) => f.endsWith('.answer.json')).sort();
  expect(answers.length, '정답지가 없습니다').toBeGreaterThan(0);

  const rows: Row[] = [];

  for (const answerFile of answers) {
    const answer = JSON.parse(readFileSync(join(dir!, answerFile), 'utf8')) as Answer;
    const base = answerFile.replace('.answer.json', '');
    const doc = readdirSync(dir!).find(
      (f) => f.startsWith(base) && MEDIA[extname(f).toLowerCase()] !== undefined,
    );
    expect(doc, `${base}에 대응하는 문서 파일이 없습니다`).toBeTruthy();

    const result = await parseDocument({
      documentType: answer.document_type,
      mediaType: MEDIA[extname(doc!).toLowerCase()],
      data: readFileSync(join(dir!, doc!)).toString('base64'),
      ...(answer.today ? { today: answer.today } : {}),
    });

    if (result.status === 'failed') {
      rows.push({
        file: doc!, label: answer.label, status: 'failed', confidence: null,
        total: (answer.relations ?? answer.institutions ?? []).length, hit: 0, extra: 0,
        misses: [`파싱 실패: ${result.reason}`],
      });
      process.stdout.write('x');
      continue;
    }

    const score = answer.document_type === 'fss_query_result'
      ? scoreFss(result.data as ParsedFssQueryResult, answer)
      : scoreFamily(result.data as ParsedFamilyCert, answer);

    rows.push({ file: doc!, label: answer.label, status: result.status, confidence: result.confidence, ...score });
    process.stdout.write('.');
  }

  const sum = (pick: (r: Row) => number) => rows.reduce((n, r) => n + pick(r), 0);
  const total = sum((r) => r.total);
  const hit = sum((r) => r.hit);
  const extra = sum((r) => r.extra);
  const accuracy = total === 0 ? 0 : (hit / total) * 100;

  console.log('\n');
  console.log('─────────────────────────────────────────────');
  console.log(' 설계서 8.3 파싱 정확도 (실 API 측정)');
  console.log('─────────────────────────────────────────────');
  for (const r of rows) {
    const pct = r.total === 0 ? '—' : `${((r.hit / r.total) * 100).toFixed(0)}%`;
    console.log(
      ` ${r.file.padEnd(14)} ${String(r.hit).padStart(2)}/${r.total}  ${pct.padStart(4)}` +
      `  conf ${r.confidence === null ? '—' : r.confidence.toFixed(2)}  ${r.status}`,
    );
    for (const m of r.misses) console.log(`     · ${m}`);
    if (r.extra > 0) console.log(`     · 정답에 없는 항목 ${r.extra}건`);
  }
  console.log('');
  console.log(` 문서            ${rows.length}건`);
  console.log(` 정답 항목       ${total}건`);
  console.log(` 정확 추출       ${hit}건`);
  console.log(` 없는 항목 생성   ${extra}건`);
  console.log('');
  console.log(` 파싱 정확도     ${accuracy.toFixed(1)}%  (목표 90% 이상)`);
  console.log('─────────────────────────────────────────────');

  expect(rows.length).toBeGreaterThan(0);
});
