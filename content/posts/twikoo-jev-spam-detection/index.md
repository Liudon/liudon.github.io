---
title: "给 Twikoo 接入 Jev，用 AI 判断博客评论是不是广告"
date: 2026-09-23T09:57:24+08:00
draft: false
tags:
  - Twikoo
  - Jev
  - AI
  - 博客优化
keywords:
  - Twikoo Jev
  - Jev
  - Twikoo 垃圾评论
  - 博客评论反垃圾
  - System One
  - AI 垃圾评论检测
description: "给 Twikoo 接入 Jev / System One，通过评论正文、昵称和网址综合判断垃圾评论，并记录实际测试、Prompt 调整和阈值选择过程。"
---

## 前言

最近 Jev 火了，时间线上全是讨论这个新模型的内容。

> Jev 是 TypeSafe AI 发布的首个 System One 模型，主要面向软件中的快速、结构化决策。

和 ChatGPT、Claude 这类偏文本生成的大模型不太一样，它更偏向于“做判断”：输入一组状态和问题，直接返回结构化的判断结果以及概率。

刷微博的时候，发现酱紫表大佬利用 Jev 做了一个判断微博内容是不是广告的插件，详细见[原微博](https://weibo.com/3138279871/Rj8amuD0g)。

刚好这两天折腾了一下 Twikoo 评论，想着能不能把 Jev 的能力加到 Twikoo 里。

现在有了 AI 助力，咱们说干就干。

## 实现

### Twikoo 当前的评论检测机制

我们先来看一下 Twikoo 当前的评论检测机制。

```text
评论提交
   ↓
长度 / 黑名单 / 禁用词等检查
   ↓
验证码
   ↓
限流
   ↓
外部垃圾评论检测
```

当评论提交后，会先经过一些前置的基础检查，最后会进入到外部垃圾评论检测机制。

Twikoo 目前支持了腾讯云内容安全、Akismet 和 LLM 三种方式进行检查。

这里并不会把一条评论依次交给所有服务判断，它采用的是互斥方式，谁排在前面并且已经配置，就使用谁。

```typescript
if (config.QCLOUD_SECRET_ID && config.QCLOUD_SECRET_KEY) {
  // Tencent TMS
} else if (config.AKISMET_KEY) {
  // Akismet
} else if (config.LLM_API_KEY) {
  // LLM
}
```

### Jev 能直接走 LLM 吗？

既然已经支持 LLM 方式了，能不能直接用 LLM 进行 Jev 的接入呢？

答案是不行。

Twikoo 的 LLM 实现走的是 OpenAI Compatible 的文本生成接口，大致流程如下。

```text
Twikoo
   ↓
messages
   ↓
OpenAI Compatible API
   ↓
生成文本
   ↓
{"spam": true}
   ↓
JSON.parse()
```

Jev 的接口完全不是这套协议。

```
POST /v1/systemone

请求数据：
state
+
questions

返回：
answers.spam.noul
```

完全是两种不同的接口。

理论上当然也可以在中间再搞一个兼容层：

```text
Twikoo LLM
    ↓
OpenAI Compatible Bridge
    ↓
Jev System One
```

但是为了少改几行 Twikoo 代码，反而又多维护一个服务，感觉有点本末倒置。

所以最终决定，**直接给 Twikoo 增加一个 Jev 检测器**。

### 接入 Jev

实现本身并不复杂。

- 增加配置项

```text
JEV_API_KEY
JEV_API_ENDPOINT
JEV_MODEL
JEV_SPAM_THRESHOLD
```

默认值为：

```text
JEV_API_ENDPOINT=https://api.typesafe.ai/v1/systemone
JEV_MODEL=jev-latest
JEV_SPAM_THRESHOLD=0.85
```

- 调用 Jev

```typescript
const response = await httpPost(
  endpoint,
  {
    model,
    state: {
      comment: comment.comment || "",
      nickname: comment.nick || "",
      website: comment.link || "",
    },
    questions: {
      spam: {
        type: "noul",
        instructions: "...",
      },
    },
  },
  {
    headers: {
      Authorization: `Bearer ${String(config.JEV_API_KEY)}`,
      "Content-Type": "application/json",
    },
    timeout: 30000,
  },
);
```

注意，这里把评论正文、昵称和网址这三个信息一起交给它进行判断。

因为有很多软广告，评论内容看着正常，但是会挂一个引流的昵称和网址。

所以这里我希望 Jev 判断的不是：

> 这句话是不是广告？

而是：

> 这个完整的评论提交行为，是不是在利用博客评论做推广？

### 第一次测试

*下面这些测试是在调参阶段完成的，当时 JEV_SPAM_THRESHOLD 仍然设置为 0.9，最终默认值是在全部测试完成后才调整为 0.85。*

代码写完以后，先用真实 Jev API 测了一下。

正常评论：

```text
这个 CORS 问题我之前也遇到过，感谢分享解决方案。
```

返回：

```text
Jev 判定为 HAM
(score=0.0300, threshold=0.9, model="jev-1.13.0")
```

很正常。

然后测试一个明显广告：

```text
专业网站建设、SEO 优化、快速提升 Google 排名，
价格优惠，联系 example.com
```

返回：

```text
Jev 判定为 SPAM
(score=0.9700, threshold=0.9, model="jev-1.13.0")
```

这个也没问题。

接下来测试前面说的那种软广告：

```text
正文：
文章写得很好，学习了！

昵称：
SEO Agency

网址：
https://example-seo.com
```

结果却是：

```text
Jev 判定为 HAM
(score=0.7100, threshold=0.9, model="jev-1.13.0")
```

这个结果就有点意思了。

虽然最终判断是 HAM，但：

```text
0.71
```

已经明显高于正常评论的：

```text
0.03
```

也就是说：

**Jev 已经觉得它挺可疑，只是还没有可疑到超过 0.9。**

这时候最简单的办法当然是：

```text
把 threshold 从 0.9 降到 0.7。
```

但想了一下，没有马上这么做。

因为降低阈值虽然能提高垃圾评论召回率，也有可能增加正常评论的误杀，所以决定还是优先调整判断规则描述。

### 调整 instructions

第一版的内容比较简单：

```text
Is this submission spam for a personal blog? Treat unsolicited commercial advertisements, promotional links, SEO/link spam, scams, meaningless repetitive content, and automated promotional greetings as spam. Treat genuine questions, technical discussions, constructive feedback, and normal greetings as not spam. Consider all state fields, including nickname and website.
```

第一版其实已经告诉 Jev 要看 nickname 和 website，但对“正文看起来正常，昵称或网址却明显带有推广意图”这种软广告，描述得还不够明确。

后来重点增加了几条规则：

```text
Evaluate the comment text, nickname, and website together.
```

以及：

```text
A harmless-looking comment does not make the submission legitimate
if the nickname or website is primarily being used for promotion.
```

意思就是：

> 正文看起来无害，并不能证明这是一条正常评论。
>
> 如果昵称或者网站明显用于推广，也应该作为重要判断依据。

同时又增加了一条反方向规则：

```text
Do not penalize genuine personal blogs, developer websites,
project pages, or personal homepages...
```

避免走向另一个极端：

```text
有网址 = 垃圾评论
```

我的目标其实很明确。

需要区分的是：

```text
正常交流 + 正常个人网站
```

和：

```text
空洞评论 + 明显商业推广身份
```

而不是简单看有没有 URL。

### 再次测试

调整 instructions 后，再跑了一轮，这次结果明显好了很多。

*以下结果来自本轮真实 API 测试，部分网址使用示例域名替换。*

| 正文                                               | 昵称         | 网址                        | 结果   |     Score |
| ------------------------------------------------ | ---------- | ------------------------- | ---- | --------: |
| 这个 CORS 问题我之前也遇到过，感谢分享解决方案。                      | —          | —                         | HAM  |      0.05 |
| 专业网站建设、SEO 优化、快速提升 Google 排名，价格优惠，联系 example.com | —          | —                         | SPAM |      0.98 |
| 文章写得很好，学习了！                                      | SEO Agency | example-seo.com           | SPAM |      0.95 |
| 我也做了一个类似项目，有些实现思路不太一样，可以交流一下。                    | Tom        | tom.example.com           | HAM  | 0.12～0.15 |
| 感谢分享，学到了不少东西。                                    | Alex       | alex.example.com          | HAM  |      0.22 |
| 感谢分享，学到了很多。                                      | SEO Agency | —                         | SPAM |      0.90 |
| twikoo 2.x 的大版本更新引入的问题，升级到最新的 2.0.7 以上版本就好了                      | Alex       | some-company.com          | HAM  |      0.17 |
| 写得真好！                                            | Liu        | personal-blog.example.com | HAM  |      0.12 |
| 感谢分享！                                            | 深圳网站建设     | example.com               | SPAM |      0.90 |

其中最明显的就是前面那条软广告。

同样的数据：

```text
文章写得很好，学习了！
SEO Agency
https://example-seo.com
```

第一版：

```text
HAM
score=0.71
```

调整 instructions 以后：

```text
SPAM
score=0.95
```

这一轮测试下来，正常评论的结果基本集中在：

```text
0.05
0.12
0.15
0.17
0.22
```

软广告则到了：

```text
0.90
0.95
```

明显广告：

```text
0.98
```

中间其实出现了比较大的空档：

```text
正常评论

0.05 ~ 0.22

        ↓

     很大间隔

        ↓

软广告 / 广告

0.90 ~ 0.98
```

考虑到模型结果本身可能存在一定波动，最后还是给它留了一点空间，把默认值调整成：

```text
JEV_SPAM_THRESHOLD=0.85
```

## 总结

本来只是看到别人拿 Jev 判断微博广告，觉得挺好玩，没想到放到博客评论里效果也还不错。

当前实现已提交 PR [twikoojs/twikoo#1182](https://github.com/twikoojs/twikoo/pull/1182)，待官方审核。

**09/25 日更新：PR 已合入，升级到 2.0.9 及之后的版本即可，[配置文档](https://twikoo.js.org/faq.html#%E9%85%8D%E7%BD%AE-jev-%E5%8F%8D%E5%9E%83%E5%9C%BE%E6%9C%8D%E5%8A%A1)。**

后面如果 PR 能合入 Twikoo，等正式版本发布后，我会在博客真实评论环境里继续跑一段时间。
