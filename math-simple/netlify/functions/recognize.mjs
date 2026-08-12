import { ok, fail, checkPass, callClaude, parseJSON } from './_lib.mjs';

export const config = { path: '/api/recognize' };

const MAX_BYTES = 5 * 1024 * 1024;

const INSTRUCTION = [
  '이 이미지에 있는 초등 수학 문제를 그대로 읽어 텍스트로 옮겨라.',
  '문제를 풀지 마라. 정답이나 풀이를 쓰지 마라.',
  '문제가 여러 개면 가장 크게 보이는 것 하나만 옮긴다.',
  '아래 JSON만 출력한다. 다른 텍스트·백틱 금지.',
  '{"problem_text":"...","domain":"수와 연산|도형|측정|규칙성|자료와 가능성","type":"문제 유형 한 줄"}',
].join('\n');

export default async (req) => {
  if (req.method !== 'POST') return fail(405, 'POST만 받습니다.');
  if (!checkPass(req)) return fail(401, '암호가 맞지 않습니다.');

  let body;
  try { body = await req.json(); } catch { return fail(400, '잘못된 요청입니다.'); }

  const { image_base64, media_type = 'image/jpeg' } = body;
  if (!image_base64) return fail(400, '이미지가 없습니다.');
  if (image_base64.length * 0.75 > MAX_BYTES) return fail(413, '사진이 너무 커요. 다시 찍어 볼까?');

  try {
    const text = await callClaude({
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type, data: image_base64 } },
          { type: 'text', text: INSTRUCTION },
        ],
      }],
    });
    const j = parseJSON(text);
    return ok({ problem_text: j.problem_text || '', domain: j.domain || null, type: j.type || null });
  } catch (err) {
    console.error('recognize failed', err);
    return fail(502, '문제를 읽지 못했어요. 다시 찍거나 직접 적어 주세요.');
  }
};
