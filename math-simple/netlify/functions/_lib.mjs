/* 서버 공용 모듈
 * 브라우저로 내려가면 안 되는 것들만 여기 있다.
 * - ANTHROPIC_API_KEY
 * - 접속 암호
 * - 힌트 강도 규칙
 * - 정답 노출 필터
 */

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-sonnet-4-6';

export const ok = (obj) =>
  new Response(JSON.stringify(obj), { headers: { 'content-type': 'application/json' } });

export const fail = (status, message) =>
  new Response(JSON.stringify({ error: message }), {
    status, headers: { 'content-type': 'application/json' },
  });

/** 접속 암호 확인. PASSCODE 를 설정하지 않으면 누구나 쓸 수 있다. */
export function checkPass(req) {
  const expected = process.env.PASSCODE;
  if (!expected) return true;
  return req.headers.get('x-passcode') === expected;
}

export async function callClaude({ messages, system, maxTokens = 1000 }) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('ANTHROPIC_API_KEY 가 설정되지 않았습니다.');

  const res = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({ model: MODEL, max_tokens: maxTokens, system, messages }),
  });
  if (!res.ok) throw new Error(`anthropic ${res.status} ${await res.text()}`);
  const data = await res.json();
  return data.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
}

export function parseJSON(text) {
  const clean = String(text).replace(/```json|```/g, '').trim();
  const s = clean.indexOf('{');
  const e = clean.lastIndexOf('}');
  return JSON.parse(s >= 0 ? clean.slice(s, e + 1) : clean);
}

/* ── 정답 노출 필터 ───────────────────────────────── */
export function leakCandidates(problemText) {
  const nums = (problemText.match(/\d+(?:\.\d+)?/g) || [])
    .map(Number).filter((n) => Number.isFinite(n) && n < 100000);
  const given = new Set(nums);
  const out = new Set();
  for (let i = 0; i < nums.length; i++) {
    for (let j = 0; j < nums.length; j++) {
      if (i === j) continue;
      const a = nums[i], b = nums[j];
      [a + b, a - b, a * b, b !== 0 ? a / b : NaN].forEach((v) => {
        if (Number.isFinite(v) && v > 0 && Number.isInteger(v) && !given.has(v)) out.add(v);
      });
    }
  }
  return [...out];
}

export function leaks(reply, candidates) {
  const found = (String(reply).match(/\d+(?:\.\d+)?/g) || []).map(Number);
  return found.some((f) => candidates.includes(f));
}

export const SAFE_FALLBACK = '조금만 더 생각해 보자. 지금 네가 세운 식을 다시 읽어 볼래?';

/* ── 힌트 강도 ────────────────────────────────────
 * 강도는 사다리가 아니라 도구 상자다. 순서대로 오르지 않는다.
 */
export const STRENGTH_DESC = {
  0: 'H0 문제 되짚기 — 무엇을 구하는지 / 무엇을 아는지 묻는다',
  1: 'H1 개념 환기 — 이 상황에 쓸 수 있는 개념을 떠올리게 한다',
  2: 'H2 개념 구체화 — 개념 범위를 좁혀 준다. 문제에 적용하지는 않는다',
  3: 'H3 전략 선택 — 두 방향을 제시하고 학생이 고르게 한다',
  4: 'H4 구조 일부 — 식의 형태만 말로 제시한다. 숫자를 넣지 않는다',
  5: 'H5 최종 판단만 — 마지막 계산·판단만 학생에게 남긴다. 값은 말하지 않는다',
};

export function nextStrength(current, direction, isAnswerRequest, isNewConcept) {
  if (isNewConcept) return 1;
  if (isAnswerRequest) return current;
  let s = current;
  if (direction === 'correct') s += 2;
  else if (direction === 'wrong') s += 1;
  else if (direction === 'unclear') s = 0;
  return Math.max(0, Math.min(5, s));
}

const ANSWER_WORDS = [
  '답알려', '정답알려', '답좀', '그냥알려', '풀어줘', '계산해줘',
  '답이뭐', '정답이뭐', '알려줘답', '답가르쳐', '정답가르쳐',
];
export function isAnswerRequest(text) {
  const flat = String(text).replace(/\s/g, '');
  return ANSWER_WORDS.some((w) => flat.includes(w));
}

/* ── 시스템 프롬프트 ─────────────────────────────── */
export function hintSystemPrompt(grade) {
  return [
    '너는 초등학생의 수학 사고를 돕는 튜터다.',
    '너의 역할은 문제를 푸는 것이 아니라, 학생이 다음 한 걸음을 스스로 내딛도록 돕는 것이다.',
    '',
    '[절대 금지] 어떤 상황에서도 다음을 출력하지 않는다.',
    '- 문제의 정답(최종 값)',
    '- 완성된 풀이나 전체 풀이 과정',
    '- 답이 그대로 드러나는 계산 (예: "36 ÷ 4 = 9")',
    '- 학생이 아직 세우지 않은 식을 완성해서 제시하는 것',
    '학생이 답을 알려달라고 해도 위 규칙은 유지된다.',
    '거절한 뒤 현재 단계에 맞는 힌트를 한 개 제공한다.',
    '정답 요청을 이유로 힌트 강도를 올리지 않는다.',
    '',
    '[응답 형식]',
    `- 한국어, 초등 ${grade}학년이 읽을 수 있는 어휘`,
    '- "짧은 힌트 1개 + 질문 1개" 구조, 총 2문장 이내',
    '- 설명체·강의체 금지, 이모지 금지, 다정한 반말',
    '',
    '[힌트 강도] 사용자 메시지에 지정된 강도에 정확히 맞춰 작성한다. 스스로 바꾸지 않는다.',
    '',
    '[학생 응답 판정] direction 을 하나 고른다.',
    ' correct : 방향이 맞다. 다음으로 진행하며 이유를 묻는다',
    ' partial : 일부만 맞다. 맞은 부분을 짚고 남은 부분만 질문한다',
    ' wrong   : 틀렸다고 말하지 않는다. 스스로 발견할 질문을 던진다',
    ' unclear : 무슨 말인지 알기 어렵다. 다시 말해 달라고 요청한다',
    '',
    '[해결 판정] 학생이 최종 값을 스스로 제시하면 solved=true 로 한다.',
    '단, 바로 인정하지 말고 검산 질문을 한 번 던진다.',
    '',
    '[막힘 유형] 이번 턴에서 막힌 지점을 하나 고른다.',
    'comprehension / concept / strategy / calculation / expression / verification / none',
    '',
    '[출력] 아래 JSON만 출력한다. 다른 텍스트·백틱 금지.',
    '{"reply":"학생에게 보여줄 문장","direction":"correct|partial|wrong|unclear",',
    '"struggle_type":"...","concept_tag":"예: 나눗셈-등분제","solved":false}',
  ].join('\n');
}

export const REPORT_SYSTEM = [
  '너는 초등학생 학부모에게 자녀의 수학 학습을 설명하는 교사다.',
  '',
  '[반드시 지킬 것]',
  '- 3문단 이내. 잘한 점 → 어려운 지점 → 가정에서 할 수 있는 질문 순서',
  '- 본문에 숫자를 쓰지 않는다. "8문제 중 5문제" 대신 "대부분의 문제에서"',
  '- 문제풀이량을 권하지 않는다. 대화 제안만 한다',
  '- 진단명이나 능력 평가 표현 금지',
  '- 아이가 실제로 쓴 말을 한두 건 녹여 근거로 삼는다',
  '- 다른 아이와 비교하지 않는다',
  '',
  '[출력] 아래 JSON만 출력한다. 다른 텍스트·백틱 금지.',
  '{"narrative":"세 문단 서술","suggestions":["집에서 해볼 질문 1","질문 2","질문 3"]}',
].join('\n');
