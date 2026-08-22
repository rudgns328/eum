import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const ENGINE_DIR = join(process.cwd(), 'lib', 'engines');

const engineFiles = readdirSync(ENGINE_DIR)
  .filter((f) => f.endsWith('.ts'))
  .map((f) => ({ name: f, source: readFileSync(join(ENGINE_DIR, f), 'utf8') }));

describe('절대규칙 2 — /lib/engines는 LLM을 import하지 않는다', () => {
  it('엔진 파일이 존재한다', () => {
    expect(engineFiles.length).toBeGreaterThan(0);
  });

  for (const file of engineFiles) {
    it(`${file.name}에 LLM 의존이 없다`, () => {
      const imports = [...file.source.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]);
      for (const specifier of imports) {
        expect(specifier, `${file.name} → ${specifier}`).not.toMatch(/anthropic/i);
        expect(specifier, `${file.name} → ${specifier}`).not.toMatch(/^@\/lib\/llm/);
      }
    });
  }
});

describe('절대규칙 4 — 엔진은 주민등록번호·생년월일을 다루지 않는다', () => {
  for (const file of engineFiles) {
    it(`${file.name}에 개인 식별 필드가 없다`, () => {
      // 주석에서 규칙을 설명하는 문장은 허용하고, 필드 선언만 검사한다.
      const fieldDeclarations = file.source.match(/^\s*(?:readonly\s+)?[a-z_]+\??:/gm) ?? [];
      for (const declaration of fieldDeclarations) {
        expect(declaration, `${file.name} → ${declaration}`).not.toMatch(
          /\b(rrn|resident_registration_number|birth_date|birthdate|ssn)\b/i,
        );
      }
    });
  }
});

describe('데이터 정본 — 엔진은 data/를 읽기만 한다', () => {
  for (const file of engineFiles) {
    it(`${file.name}에 파일 쓰기가 없다`, () => {
      expect(file.source).not.toMatch(/writeFileSync|writeFile\(|fs\.write/);
    });
  }

  it('deadlines_patch.json을 import하지 않는다 (병합 완료본, 근거 보존용)', () => {
    for (const file of engineFiles) {
      const imports = [...file.source.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]);
      for (const specifier of imports) {
        expect(specifier, `${file.name} → ${specifier}`).not.toContain('deadlines_patch');
      }
    }
  });
});
