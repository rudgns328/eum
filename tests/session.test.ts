/**
 * 세션 저장 규칙.
 *
 * 케이스는 이 탭에서만 산다. 브라우저에 남겨 두면 기기마다 보이는 내용이
 * 달라져 사용자가 규칙을 알 수 없다 — PC에서 넣은 것이 폰에는 없는데
 * 알림 메일은 계속 온다. 화면 문구도 그 전제로 쓰여 있으므로, 저장소가
 * 조용히 localStorage로 돌아가면 안내가 거짓말이 된다.
 *
 * DOM이 없는 환경이라 동작이 아니라 소스를 검사한다.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { EXAMPLE_CASE, EXAMPLE_DEADLINES, EXAMPLE_MAIL } from '@/app/_lib/example';

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      out.push(...sourceFiles(path));
    } else if (/\.tsx?$/.test(entry)) {
      out.push(path);
    }
  }
  return out;
}

describe('저장 범위', () => {
  it('케이스 저장소는 sessionStorage를 쓴다', () => {
    const source = readFileSync('lib/case/store.ts', 'utf8');
    expect(source).toContain('sessionStorage');
    expect(source).not.toContain('localStorage');
  });

  it('화면 코드 어디서도 localStorage를 쓰지 않는다', () => {
    const offenders = [...sourceFiles('app'), ...sourceFiles('lib')].filter((path) =>
      readFileSync(path, 'utf8').includes('localStorage'),
    );
    expect(offenders).toEqual([]);
  });
});

describe('소개 화면 예시', () => {
  it('기한은 예시 케이스의 보유 항목과 어긋나지 않는다', () => {
    // 히어로와 이용 흐름이 서로 다른 가정으로 계산해, 같은 사망일인데
    // 기한 목록이 달랐던 적이 있다. 한 벌에서만 나오는지 못박는다.
    const ids = EXAMPLE_DEADLINES.map((deadline) => deadline.deadline_id);
    expect(ids).toContain('renunciation');
    expect(ids.includes('vehicle_transfer')).toBe(EXAMPLE_CASE.has_vehicle);
    expect(ids.includes('acquisition_tax')).toBe(EXAMPLE_CASE.has_real_estate);
  });

  it('메일 미리보기는 실제 발송 함수가 만든 것이다', () => {
    expect(EXAMPLE_MAIL).not.toBeNull();
    expect(EXAMPLE_MAIL?.subject).toMatch(/^\[이음\]/);
    // 호칭만 쓰고 이름을 쓰지 않는다(절대규칙 4)
    expect(EXAMPLE_MAIL?.text).toContain(EXAMPLE_CASE.decedent_label);
    expect(EXAMPLE_MAIL?.text).not.toContain('○○');
  });
});
