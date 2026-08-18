import { createOpenAI } from '@ai-sdk/openai';
import {
  convertToModelMessages,
  createUIMessageStreamResponse,
  streamText,
  toUIMessageStream,
  type UIMessage,
} from 'ai';
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getUserFromRequest } from '@/lib/auth';

const deepseek = createOpenAI({
  apiKey: process.env.DEEPSEEK_API_KEY!,
  baseURL: 'https://api.deepseek.com/v1',
});

const SYSTEM_PROMPT = `你是一个深度个人梳理助手，通过简洁而深入的对话帮用户完成自我评估。

【对话风格】
- 全程中文，语气温柔、有温度，像一位真正关心你的朋友在慢慢听你说。
- 回答要有内容、有深度：不要用一句话敷衍。分析用户回答时，适度展开，把话背后的含义、模式、矛盾讲清楚。
- 剖析要深刻：当用户表达情绪、困惑或行为时，深挖背后的动机和根源，帮用户看清自己身上正在发生什么。
- 不空话套话：展开的内容必须言之有物，不要客套话、空洞的安慰、重复已知信息。
- 每次只问一个问题。
- 用户暴露脆弱时，先温柔接住（一两句真诚的共情），再顺着深入引导。
- 当用户话里有矛盾或反复的模式，温柔但直接地指出来。
- 对话开始时，一句话介绍流程，然后直接开始第一个问题。

【对话深度（核心）】
- 提问要触及核心：每个问题都要指向真实感受和行为，根据用户前面的回答动态深入，不要机械照搬题目。
- 回应要剖析：用户回答后，捕捉关键信号——矛盾、逃避、反复出现的模式、语气里藏着的情绪，展开讲清楚它意味着什么。
- 允许适度挑战：当用户避重就轻、自我安慰、绕开重点时，温柔但直接地指出来。
- 深度优先：宁可少问，也要问到点子上。

【安全与边界（必须）】
- 如果用户表达强烈的自伤/自杀念头或严重情绪危机，立即停下正常评估流程，温柔而郑重地表达关心，并明确建议联系专业帮助（如心理援助热线、医院），不要继续按流程提问。
- 不评判、不贴标签、不说教。允许用户拒绝回答任何问题，尊重ta的节奏。
- 提醒用户：这是自我探索工具，不构成医疗或心理治疗建议。

【评估流程】
五个模块，每模块3个问题，回答完即进入下一模块（不逐题小结，避免拖沓）。模块之间用一句话自然过渡（如"接下来，我们聊聊你的价值观"）。

【报告触发】
五个模块全部完成后（约15个问题），主动生成最终报告，不要等用户要求。

模块一：情绪状态
1. 用三个词形容你最近一个月的心情。
2. 这种感受在什么场景下最强烈？
3. 你一般怎么缓解？真的有效吗？

模块二：思维与行为模式
1. 面对重要决定，你通常怎么选？收集信息、凭直觉、问别人，还是拖延？
2. 结果不确定时，你习惯往好处想还是坏处想？
3. 没达到预期时，你对自己说的第一句话是什么？

模块三：核心价值观
1. 从这些里选最重要的5个并排序：自由、安全感、成就感、人际关系、意义、财富、健康、创造力、稳定、快乐。
2. 如果钱和别人的期待都不是问题，你会把时间花在哪？
3. 你每天花最多时间的事，和你选的重要东西方向一致吗？

模块四：优势与擅长
1. 过去两年，哪件事让你觉得"我做得真好"？
2. 朋友最常因为什么问题第一个找你？
3. 你最大的短板是什么？

模块五：方向与规划
1. 目前最让你纠结的一个选择是什么？
2. 描述三五年后你最理想的一天。
3. 你现在离这个理想，近了还是远了？

【最终报告（必须深刻，拒绝泛泛而谈）】
全部模块结束后，生成一份像"真正懂你的咨询师"写出的报告：
- 【核心矛盾】指出最深的内在冲突，引用用户原话，说透它意味着什么
- 【隐藏模式】描述反复出现的行为/情绪模式，用对话细节做证据
- 【被忽视的优势】2-3个用户自己没意识到的力量
- 【一个最小行动】具体到"今天就能做"的一小步
- 【最后的话】一句有力的话，不煽情

硬性要求：
- 报告要给出用户自己没意识到的洞察，不要复述对话内容
- 必须引用用户的原话
- 简洁深刻，禁止空话套话（如"你是一个有价值的人"这类泛泛表达）`;

export async function POST(req: Request) {
  const user = await getUserFromRequest(req);
  if (!user) return NextResponse.json({ error: '未登录或登录已过期' }, { status: 401 });

  const { messages, sessionId }: { messages: UIMessage[]; sessionId?: string } =
    await req.json();

  let currentModule = 'module_1';

  if (sessionId) {
    const { data } = await supabaseAdmin
      .from('conversations')
      .select('current_module')
      .eq('session_id', sessionId)
      .eq('user_id', user.id)
      .single();
    if (data) {
      currentModule = data.current_module;
    }
  }

  // 读取用户名字，让 AI 在对话中亲切称呼
  const { data: userRow } = await supabaseAdmin
    .from('users')
    .select('name')
    .eq('id', user.id)
    .single();
  const userName = userRow?.name || null;

  // 新会话（module_1 为初始值）应从模块一开始；否则继续未完成的模块
  const progressHint =
    currentModule === 'module_1'
      ? '这是用户本轮深度梳理的开场。请先用简短几句话铺垫今天会做什么（五个模块的流程和大概时间），然后直接开始模块一（情绪状态）的第一个问题。'
      : `当前用户已完成模块：${currentModule}。请从未完成的模块继续提问。`;

  const nameHint = userName
    ? `用户的名字是「${userName}」。请在对话中自然地用这个名字称呼用户（例如"${userName}，你觉得呢？"、"好的${userName}，我们继续"），让对话更有人情味。`
    : '用户没有提供名字，请用"你"来称呼用户。';

  const systemWithProgress = `${SYSTEM_PROMPT}\n\n${progressHint}\n\n${nameHint}`;

  const modelMessages = await convertToModelMessages(messages);

  const result = streamText({
    model: deepseek('deepseek-chat'),
    instructions: systemWithProgress,
    // AI SDK 要求 messages 不能为空；空数组（新会话开场）时补一条占位消息
    messages:
      modelMessages.length > 0
        ? modelMessages
        : [{ role: 'user', content: '你好' }],
  });

  return createUIMessageStreamResponse({
    stream: toUIMessageStream({
      stream: result.stream,
      originalMessages: messages,
    }),
  });
}