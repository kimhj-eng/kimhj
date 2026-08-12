import {
  ok, fail, checkPass, callClaude, parseJSON,
  leakCandidates, leaks, SAFE_FALLBACK,
  STRENGTH_DESC, nextStrength, isAnswerRequest, hintSystemPrompt,
} from './_lib.mjs';

export const config = { path: '/api/hint' };

export default async (req) => {
  if (req.method !== 'POST') return fail(405, 'POST만 받습니다.');
  if (!checkPass(req)) return fail(401, '암호가 맞지 않습니다.');

  let body;
  try { body = await req.json(); } catch { return fail(400, '잘못된 요청입니다.'); }

  const { problem, grade = 3, history = [], state = {}, student_text = null } = body;
  if (!problem) return fail(400, '문제가 없습니다.');

  const strength = Math.max(0, Math.min(5, Number(state.strength ?? 1)));
  const answerReq = student_text ? isAnswerRequest(student_text) : false;
  const isFirst = student_text === null;

  const userMsg = [
    `[문제] ${problem}`,
    `[학년] 초등 ${grade}학년`,
    isFirst ? '' : '[지금까지의 대화]',
    isFirst ? '' : history.map((h) => (h.who === 'ai' ? 'AI: ' : '학생: ') + h.text).join('\n'),
    '',
    `[힌트 강도] ${STRENGTH_DESC[strength]}`,
    answerReq
      ? '[주의] 학생이 답을 알려달라고 요청했다. 정답을 주지 말고, 거절한 뒤 위 강도의 힌트를 한 개 제공하라.'
      : '',
    state.verifying
      ? '[주의] 직전에 검산 질문을 던졌다. 학생이 확인했다면 짧게 마무리하고 solved=true 를 유지하라.'
      : '',
    '',
    isFirst
      ? '세션의 첫 턴이다. 학생은 아직 아무 말도 하지 않았다. 위 강도에 맞는 첫 힌트를 만들어라. direction 은 "unclear" 로 둔다.'
      : '학생의 마지막 발화를 판정하고, 위 강도에 맞는 다음 힌트를 만들어라.',
  ].filter(Boolean).join('\n');

  const candidates = leakCandidates(problem);
  const system = hintSystemPrompt(grade);

  let result = null;
  let filtered = false;

  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      const msg = attempt === 0
        ? userMsg
        : userMsg + '\n\n[재작성] 직전 응답에 정답에 해당하는 수가 들어 있었다. 어떤 계산 결과도 숫자로 쓰지 말고 다시 작성하라.';
      result = parseJSON(await callClaude({ messages: [{ role: 'user', content: msg }], system }));
      if (!leaks(result.reply || '', candidates)) break;
      filtered = true;
    }
    if (filtered && leaks(result.reply || '', candidates)) result.reply = SAFE_FALLBACK;
  } catch (err) {
    console.error('hint failed', err);
    return fail(502, '연결이 잠깐 끊겼어. 한 번만 다시 보내 줄래?');
  }

  const direction = result.direction || 'unclear';
  const conceptTag = result.concept_tag || null;
  const isNewConcept = Boolean(conceptTag && state.concept && conceptTag !== state.concept);
  const next = isFirst ? strength : nextStrength(strength, direction, answerReq, isNewConcept);

  return ok({
    reply: result.reply || '',
    direction,
    struggle_type: result.struggle_type || 'none',
    concept_tag: conceptTag,
    solved: Boolean(result.solved),
    used_strength: strength,
    filtered,
    answer_request: answerReq,
    next_state: { strength: next, concept: conceptTag || state.concept || null, verifying: Boolean(result.solved) },
  });
};
