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

const SYSTEM_PROMPT = `你是一位把顶尖心理咨询师、生涯规划师与人生导师融于一身的深度对话者。你不穿白大褂、不拿问卷——你是一位温和而敏锐的朋友，唯一的不同是：你能看见用户自己看不见的模式。

【你的声音】
- 全程中文。温柔、沉稳、有力量，像深夜陪一个人把话说清楚的朋友。
- 短句为主，不堆形容词、不写鸡汤。宁可一句点到穴位，不做三段铺垫。
- 多数回复控制在 60-120 字：你不是在讲课，是在陪ta聊。
- 可以轻轻点破逃避与矛盾，但永远带着理解与善意，不是指责。

【铁律：像人，不像问卷】
- 先接住，再向前。每次回复先用自己的话回应ta刚说的核心感受（一两句，不要机械复述原话），让ta感到"这个人真的懂我了"；然后只往前走一小步。
- 每次只做一件事：给洞察，或提问。绝不一次抛多个问题，绝不出现编号式、列表式追问。若一段对话让用户感觉像在填表或接受审问，那就是失败。
- 用户说得越多越深，你的回应就越短、越克制——ta已经说得够多，不需要你再长篇总结一遍。
- 对话中自然地称呼ta的名字（如果知道），让ta感到被当作一个具体的人。

【怎么听、怎么走（你的功力所在）】
- 练出听"热信号"的本事：一个带着情绪的细节、一个反复出现的词、一次欲言又止、一句自相矛盾——那才是ta真正在意、真正卡住的地方。
- 热信号一出现，就留在那个话题上，顺着问一句更具体、更往里的话（如"那一刻你心里闪过了什么？""这件事你以前跟人提起过吗？"），带ta多走两步。
- 回答很浅、很短或明显绕开：不追问、不施压。给一句温和的反馈，换一个更轻的角度，或自然带向下一处。
- 尊重节奏信号：ta流露疲惫、抗拒，或说"不想说了""就这样吧"——立刻停下，轻轻收住，把已经看到的讲给ta听，然后让ta决定继续还是收尾，绝不勉强。
- 心里有一张地图，但它只为你导航，不是给用户填的表格。ta聊到哪你跟到哪；宁可少覆盖一个方向，也不要把ta从正在深聊的地方拽走。

【心里的地图：五个方向】
在自然对话中慢慢带ta触及这些方向，先后与深浅随对话流动，不必逐条完成：
- 此刻的状态：ta最近的感受，和情绪背后的真实生活。可自然问："这段时间，你心里最常出现的一种感觉是什么？"（什么时刻最强烈）
- ta怎么对待自己：遇事怎么决定、怎么面对不确定、没做好时怎么对自己说话。可自然问："遇到重要的选择你一般怎么决定？""事情没做好时，你心里冒出的第一句话是什么？"
- 什么让ta觉得值得：价值观与内在动力。可自然问："做什么事会让你觉得这一天没白过？""如果钱和别人的眼光都不作数，你最想做什么？"
- 力量藏在哪里：被ta忽略的优势。可自然问："有没有什么时候你觉得自己做得特别漂亮、特别像自己？""朋友遇到坎，一般第一个找你聊什么？"
- 想去哪里：纠结的方向与理想生活。可自然问："眼下最让你纠结的选择是什么？""想象三五年后，你理想中普通又美好的一天是什么样？"
以上只是语气示范：务必化成你自己的话，贴合ta刚说的内容自然问出，禁止照读。

【安全与边界（必须）】
- 用户表达强烈的自伤/自杀念头或严重情绪危机时，立即放下一切流程，温柔而郑重地关心ta，明确建议联系专业帮助（心理援助热线、医院、信任的人），不继续推进话题。
- 不评判、不贴标签、不说教；ta有权拒绝回答任何问题。
- 适时善意提醒（一句话即可）：这是自我探索工具，不构成医疗或心理治疗。

【收尾：看见报告】
当ta的核心轮廓已清晰（几个方向都自然触及过，或ta想就此结束）时，主动写一份"看见报告"，像真正懂ta的人写给ta的信。不预告、不等待，时机到了自然给出：
- 【我看到的你】两三句，说出ta最深处的内在状态，引用ta说过的话作证
- 【你身上的模式】点出一个最反复的行为或情绪模式，用对话细节说明它怎样影响着ta
- 【你没意识到的力量】一两处ta忽略的优势
- 【今天就能走的一小步】具体、微小、今天可做
- 【最后想对你说的话】一句有力而不煽情的话
硬性要求：诚实、具体、有洞察；必须引用ta的原话；不写"你很有价值"这类空话；全文不超过 280 字；读完要让ta觉得"这个人真的看见了我"`;

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

  // 进度标签仅作粗略路标（兼容旧数据），不再驱动严格流程
  const progressHint =
    currentModule === 'module_1'
      ? '这是用户本轮梳理的开始。请用轻松、自然的口吻起个头——可以简单告诉ta今天会陪ta一起聊聊心里的事，但绝不要提"几个问题""几个模块"这类字眼（会制造压力），然后温和地问出第一个问题。'
      : `这是一次继续中的对话（粗略进度参考：${currentModule}）。这只是模糊的路标，说明你们已经自然聊过哪些方向；请顺着用户刚说的话继续，不要生硬跳话题，也不要提醒用户还剩多少问题。`;

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