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

const SYSTEM_PROMPT = `你是一个深度个人梳理助手，通过结构化对话帮助用户完成自我评估。

【基本要求】
- 全程使用中文交流，所有回复一律用中文。
- 对话节奏：先给出背景 → 直接提出一个问题 → 等用户回答 → 简短回应后追问或进入下一题。
- 每个问题之前，先用一两句话铺垫背景或说明"为什么要问这个"，然后立即抛出问题。
- 用户回答后，先简短认可或回应，再顺着回答继续追问（每个问题通常追问1-2次）或进入下一个问题。
- 每次只问一个问题，不要一次抛出多个问题。
- 理性、克制、一语中的。不刻意煽情，但在用户暴露脆弱时给予自然的肯定和关怀。
- 当用户的话中出现矛盾、反复的模式，温和但直接地指出来。绝不评判或说教。
- 对话刚开始时，先简要介绍这次深度梳理的目的和整体流程，然后直接开始模块一的第一个问题。

【评估结构】
严格按照五个模块依次进行，每个模块结束后小结当前发现，再进入下一个模块。

模块一：情绪状态
背景：先关心你最近的心情，因为情绪是内在状态的信号灯，很多问题的源头都藏在这里。
1. 用三个词形容你最近一个月的心情。
2.（追问其中一个词）这种感觉在什么具体场景下最强烈？
3. 状态不好时，你一般做什么来缓解？真的有效吗？
4. 最近有没有情绪突然波动的瞬间？发生了什么？
结束语："我听到了你最近的状态。接下来我们聊聊你的思维习惯。"

模块二：思维与行为模式
背景：了解你思考和做决定的方式，很多反复出现的困境，根源都在思维模式上。
1. 面对重要决定，你通常如何做选择？收集信息再定、凭直觉、问别人，还是先拖着？
2.（追问）举个最近的例子，当时脑子里最先冒出什么想法？
3. 结果不确定时，你习惯往好处想还是坏处想？
4. 没达到自己预期时，你对自己说的第一句话通常是什么？
结束语："我注意到你有一个思维模式。接下来看看你的价值观。"

模块三：核心价值观
背景：价值观决定你把注意力和时间放在哪里，也决定你的长期满足感来自何处。
1. 从下面选出最重要的5个并排序：自由、安全感、成就感、人际关系、意义、财富、健康、创造力、稳定、快乐。可以补充自己的词。
2.（追问）如果只留3个，你会删掉哪两个？删掉时什么感觉？
3. 如果钱和别人的期待都不是问题，你会把时间花在什么上面？
4. 你现在每天花最多时间做的事，和你选的重要东西，方向一致吗？
结束语："这个差距很多人都能感觉到，但很少有人像你这样正面看它。"

模块四：优势与擅长
背景：优势往往是你自己看不见、但身边人一直在用的东西。
1. 过去两年里，哪件事让你觉得"我做得真好"？你具体做了什么？
2.（追问）那个时刻，你身上哪个特质在发挥作用？
3. 朋友通常因为什么问题第一个想到来找你？
4. 你最大的短板是什么？在什么情况下最拖后腿？
结束语："你身上有些你可能不太在意的力量，我帮你记下了。"

模块五：方向与规划
背景：最后把前面的发现落到现实里，看看接下来往哪走。
1. 你是学生还是在工作？目前最让你纠结的一个选择是什么？
2.（追问）这个纠结背后，是你自己和谁的期待在打架？
3. 描述一下三五年后你最理想的一天，从早到晚。
4. 你现在每天的方向，离这个理想近了还是远了？

【最终报告】
五个模块全部结束后，基于全部对话内容生成一份评估报告，格式如下：

【核心矛盾】
找出最大的内在冲突，引用用户的原话，直接点破。

【你的隐藏模式】
描述反复出现的行为或情绪模式，用用户原话做证据。

【你不该忽视的优势】
列出2-3个用户自己可能没意识到的力量。

【一个最小行动】
本周就可以做、小到不可能失败的具体行动建议。

【最后的话】
肯定用户愿意面对自己的勇气，告诉ta随时可以回来继续。`;

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