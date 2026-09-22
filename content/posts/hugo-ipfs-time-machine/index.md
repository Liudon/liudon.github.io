---
title: "我给博客做了一个时光机"
date: 2026-09-21T21:23:15+08:00
draft: false
tags:
  - hugo
  - ipfs
  - 博客优化
keywords:
  - hugo ipfs
  - ipfs 博客
  - 博客时光机
  - hugo 历史快照
description: "利用 IPFS 保存的历史快照，给 Hugo 博客做了一个随机穿越过去版本的时光机。"
---

## 前言

博客早在23年的时候就接入了 IPFS 服务，通过 GitHub Actions 实现了 Cloudflare Pages 和 IPFS 两套服务托管。

整个流程大概是下面这样的，具体实现可以参考[Hugo 接入 IPFS 服务](https://liudon.com/posts/deploy-blog-to-ipfs/)这篇内容。

```text id="full-01"
Hugo Build
    │
    ├── 正常部署 → Cloudflare Pages ← liudon.com
    │
    └── IPFS → CID ← liudon.xyz
```

博客主要还是通过 `liudon.com` 来对外提供访问，`liudon.xyz` 更像是一块试验田，用来验证 Hugo 博客跑在 IPFS 服务上。

虽然 IPFS 部署的流程跑通了，但是博客始终并没有真正用到 IPFS 服务，总感觉差点意思。

既然折腾通了，那就要用起来，于是就有了这个功能：

**博客时光机。**

## 思考

最开始把博客放到 IPFS，并没有特别明确的使用场景。

怎么能把博客和 IPFS 结合起来，用上 IPFS 的能力呢？

IPFS 是基于内容寻址的。

简单理解就是：

**内容决定地址。**

当 Hugo 生成的博客内容发生变化以后，对应的 CID 也会变化。

比如今天发布一次：

```text id="full-06"
博客版本 A
    ↓
CID A
```

过几天修改了文章或者主题，再发布：

```text id="full-07"
博客版本 B
    ↓
CID B
```

正常的网站部署一般是覆盖式的。

新版本上线以后，线上看到的自然就是新版本。

而之前的网站长什么样，通常也就看不到了。

IPFS 不太一样。

CID A 对应的是版本 A 的内容。

CID B 对应的是版本 B 的内容。

只要对应内容还存在：

```text id="full-08"
CID A → 当时的博客

CID B → 后来的博客
```

新版本并不会把旧版本覆盖掉。

想到这里以后，突然发现：

> 我其实早就已经有了一堆博客历史快照。

只是以前这些 CID 都是孤立存在的，没有真正拿来做什么。

那不如把它们串起来。

以前每次部署得到的 CID，大概就是这种状态：

```text id="full-09"
CID A
CID B
CID C
CID D
CID E
...
```

单独看到其中一个 CID，我自己也不知道它对应哪一次部署。

所以真正需要补上的，并不是一套新的博客备份系统。

IPFS 已经把内容保存好了，需要做的只是给每次部署额外记录：

```text id="full-10"
CID
+
发布时间
+
Git Commit
```

这样原本没有关系的 CID 就变成了：

```text id="full-11"
某次 Commit
    ↓
Hugo Build
    ↓
IPFS CID
    ↓
部署时间
```

有了这些信息以后，就可以知道：

> 某个 CID，对应的是博客过去某一个真实存在过的版本。

到这里，“时光机”这个想法基本就出来了。

根据这些信息，按常规思路就是搞一个历史列表页，点击进入某一个历史的详情页。

我不喜欢这个实现，我想让这个功能变得**好玩**，而不单单就是增加一个列表和详情页。

既然叫“时光机”，我觉得就不应该让我先选择：

> 我要回到 2026 年 9 月 3 日下午几点。

真正有意思的方式应该是：

> 点一下，看看它把我送到哪里。

所以最后干脆不做历史列表。

也不提供时间选择。

时光机页面只做一件事情：

```text id="full-15"
启动
 ↓
随机选择一个过去的博客快照
 ↓
穿越
```

至于会回到哪一天，不提前告诉你。

可能是昨天。

也可能是一个月以前。

这种不确定性反而更有意思。

平时我大概永远不会专门去翻：

> 一个月前我的博客首页是什么样？

但时光机如果随机把我扔回去，就会顺手看两眼。

偶尔还能看到一些自己已经忘掉的东西。

这才比较符合我想做的“时光机”。

需求基本上明确了，通过 CID 索引记录历史版本，通过前端页面随机穿越到某个历史版本。

## 实现

### 整体架构

功能想清楚以后，实现反而没那么复杂。

整个时光机主要分成三部分：

```text id="full-16"
GitHub Actions
    ↓
生成并记录历史快照

ipfs-history
    ↓
保存历史索引

Hugo 静态页面
    ↓
随机选择一个快照并穿越
```

完整一点，大概是：

```text id="full-17"
                         Git Push
                            │
                            ▼
                     GitHub Actions
                            │
                            ▼
                       Hugo Build
                            │
                         public/
                            │
                ┌───────────┴───────────┐
                │                       │
                ▼                       ▼
            正常部署                  IPFS
                │                       │
                ▼                       ▼
           liudon.com                  CID
                                        │
                                        ▼
                               ipfs-history 分支
                                        │
                         ┌──────────────┴──────────────┐
                         │                             │
                         ▼                             ▼
                    months.json                  history/
                                                     │
                                              YYYY-MM.jsonl
                                                     │
                                                     ▼
                                              Hugo 时光机
                                                     │
                                              随机抽取记录
                                                     │
                                                     ▼
                                                   CID
                                                     │
                                                     ▼
                                       liudon.xyz/ipfs/<CID>/
                                                     │
                                                     ▼
                                              过去的博客
```

这里几个部分之间是相对独立的。

正常博客还是继续正常发布：

```text id="full-18"
Git Push
   ↓
Hugo Build
   ↓
liudon.com
```

IPFS 时光机只是利用同一次构建的结果，额外生成一份历史快照。

即使哪天时光机坏了，主站也完全不受影响。

这点我觉得还是挺重要的。

毕竟这是一个为了好玩加出来的功能，不能反过来影响正常博客。

### 发布时：生成并记录历史快照

#### Workflow：每次发布自动留一个快照

博客原来就已经有 GitHub Actions 发布流程。

大致就是：

```text id="full-19"
Git Push
   ↓
Checkout
   ↓
Hugo Build
   ↓
public/
   ↓
发布
```

Hugo 执行完以后，会得到最终的：

```text id="full-20"
public/
```

这个目录就是浏览器最终看到的完整静态网站。

里面已经包含：

* HTML；
* CSS；
* JavaScript；
* 图片；
* 文章页面；
* 首页；
* 分类、标签等页面。

所以 IPFS 的处理直接放在 Hugo Build 后面。

同一份：

```text id="full-21"
public/
```

同时走两条路径：

```text id="full-22"
                    public/
                       │
              ┌────────┴────────┐
              │                 │
              ▼                 ▼
          正常部署             IPFS
              │                 │
              ▼                 ▼
         liudon.com            CID
```

这样有一个好处：

**IPFS 保存的就是这次实际构建出来的网站。**

不是 Markdown。

不是 Hugo 源码。

也不是过一段时间再 checkout Git Commit 重新构建出来的一份网站。

而是当时 Workflow 真正生成出来的那一份静态文件。

每执行一次 Workflow，就会产生一个对应的 CID：

```text id="full-23"
Commit A
   ↓
Hugo Build
   ↓
CID A

Commit B
   ↓
Hugo Build
   ↓
CID B

Commit C
   ↓
Hugo Build
   ↓
CID C
```

这样博客更新得越久，IPFS 上留下来的历史切片自然也就越多。

#### Workflow 还要把 CID 记录下来

只有 CID 还不够。

如果 Workflow 只是打印：

```text id="full-24"
bafyxxxx...
```

任务跑完以后，这个 CID 很快就淹没在 Actions 日志里了。

所以生成 IPFS 快照以后，还要继续记录一些信息。

最基本的包括：

```text id="full-25"
CID
source_commit
deployed_at
```

例如：

```json id="full-26"
{
  "cid": "QmUYgSY9Safv5gTT9i2nwWLT9q5tvXzxuRBdXpv3TGAMrU",
  "source_commit": "3c9130e0d6d11a78858cb2463c9ea37e03fb1db8",
  "deployed_at": "2026-09-20T05:59:41Z"
}
```

其中：

```text id="full-27"
cid
→ 这次发布对应的博客快照

source_commit
→ 这次构建对应哪个 Git Commit

deployed_at
→ 实际部署时间
```

Workflow 最终做的事情可以概括成：

```text id="full-28"
Hugo Build
   ↓
得到 public/
   ↓
上传 IPFS
   ↓
得到 CID
   ↓
生成历史记录
   ↓
写入 ipfs-history
```

整个过程都是自动完成的。

正常写博客、提交代码、发布。

时光机的数据自然也就跟着增加了。

### IPFS 快照索引怎么组织

#### 单独用 ipfs-history 保存快照索引

IPFS 快照记录没有直接放进博客源码。

我专门用了一个 `ipfs-history` 分支，用来保存每次部署产生的 CID，以及对应的发布时间、Commit 等索引信息。

目前结构大概是：

```text id="full-30"
ipfs-history
├── latest.json
├── months.json
└── history
    ├── 2026-07.jsonl
    ├── 2026-08.jsonl
    └── 2026-09.jsonl
```

这样做主要还是为了让 `博客源码` 和 `自动生成的部署历史` 彻底分开。

源码分支继续放：

* Markdown；
* Hugo 配置；
* 主题；
* 静态资源；
* Workflow。

`ipfs-history` 则只负责：

* CID；
* 发布时间；
* Commit；
* 快照索引。

这样每次发布以后，Workflow 只需要更新 `ipfs-history` 分支，不需要再往正常源码里提交一堆自动生成的数据。

#### latest.json 记录当前快照

除了完整的历史记录，还单独维护了一个 `latest.json`，它保存最近一次成功部署的 IPFS 快照信息。

大概是：

```json
{
  "version": 1,
  "cid": "bafy...",
  "source_commit": "...",
  "deployed_at": "..."
}
```

之所以单独保留一份最新状态，是因为很多时候并不需要翻完整个历史。

对于时光机前端来说，它可以快速知道：

```text
哪个 CID 代表“现在”
```

随机穿越时就可以把这个 CID 排除掉，避免启动一次时光机，结果又回到了当前版本。

所以三个文件的职责基本就是：

```text
latest.json
→ 当前最新快照

months.json
→ 整个历史快照池的索引

history/YYYY-MM.jsonl
→ 实际的历史快照记录
```

#### 按月份拆分快照记录

最简单的做法当然是：

```text id="full-33"
history.json
```

每次发布都往里面追加一条记录。

刚开始几十条的时候没问题。

但如果博客一直更新：

```text id="full-34"
100 条
500 条
1000 条
...
```

这个文件会越来越大。

而时光机每次其实只需要：

**随机抽一条。**

完全没必要每次打开页面，都先把几年以来所有部署记录全部下载一遍。

所以最后把历史按月份拆开：

```text id="full-35"
history/
├── 2026-07.jsonl
├── 2026-08.jsonl
├── 2026-09.jsonl
├── 2026-10.jsonl
└── ...
```

每个月对应一个 JSONL 文件。

其中每一行就是一次发布。

这样文件本身比较小，写入也比较简单。

#### months.json：整个随机池的索引

既然历史文件按月份拆开了，页面就需要知道：

```text id="full-36"
现在有哪些月份？
每个月有多少条记录？
```

所以又维护了一个 `months.json` 文件。

类似这样：

```json id="full-38"
{
  "version": 2,
  "total": 51,
  "months": [
    {
      "month": "2026-09",
      "count": 36
    },
    {
      "month": "2026-08",
      "count": 14
    },
    {
      "month": "2026-07",
      "count": 1
    }
  ]
}
```

这里的月份并不是拿给用户选择的。

页面上也不会出现：

```text id="full-39"
请选择：

2026-07
2026-08
2026-09
```

它只是内部索引。

时光机打开以后，先加载这个很小的文件，就已经知道了整个随机池的结构。

例如：

```text id="full-40"
总共 51 个快照

2026-07 → 1 个
2026-08 → 14 个
2026-09 → 36 个
```

然后再决定这一次到底抽哪条记录。

#### 怎么做到全局均匀随机

这里还有一个小问题。

假设：

```text id="full-41"
2026-07   1 条
2026-08  14 条
2026-09  36 条
```

如果简单写成：

```text id="full-42"
随机一个月份
   ↓
再随机这个月的一条记录
```

那么：

```text id="full-43"
2026-07
2026-08
2026-09
```

三个自然月被选中的概率是一样的。

结果就是：

7 月唯一那条记录，被抽到的概率会远远高于 9 月的任何一条记录。

这显然不太合理。

我更希望的是：

> 每一个可用的历史快照，都有大致相同的机会被穿越到。

所以 `months.json` 里除了月份，还要保存 `count`。

随机的时候按照记录数量来选择。

例如一共有：

```text id="full-45"
51
```

条历史。

那就相当于先在：

```text id="full-46"
1 ~ 51
```

之间随机一个数字。

再通过每个月的 `count` 找出它落在哪个月。

这样某个月历史快照越多，这个月被命中的概率自然越高，但最终落到每一个具体历史快照上的概率基本是一致的。

### 历史版本重建

之前的 GitHub Actions 构建日志里本身就有 CID 信息，所以又扫描了一遍历史 Workflow，通过日志里的 CID 尝试重建时光机上线之前的历史快照。

不过真正处理时发现，时间比较久的 Actions 日志已经无法获取。最后只找回了最近两个月左右的 CID，再早的历史也就没办法恢复了。

### 穿越时：Hugo 页面怎么工作

#### 页面和历史数据分离

时光机页面没有配后端。

依然是 Hugo 正常生成出来的一个静态页面。

也就是说：

```text id="full-47"
访问时光机
   ↓
Cloudflare 返回 HTML
```

到这里和普通文章页没什么区别。

真正的随机逻辑全部由浏览器里的 JavaScript 完成。

这里我没有让 Hugo 在构建阶段读取 `ipfs-history`。

否则就会出现一个比较奇怪的流程：

```text id="full-48"
发布博客
   ↓
生成新的 CID
   ↓
更新历史
   ↓
为了让页面知道这个新 CID
   ↓
再重新发布一次博客
```

变成循环。

所以我把：

```text id="full-49"
时光机页面
```

和：

```text id="full-50"
时光机数据
```

彻底分开了。

Hugo 页面只负责：

```text id="full-51"
HTML
CSS
JavaScript
```

历史数据则在页面打开以后动态获取。

这样新增一条历史快照的时候：

```text id="full-52"
只更新 ipfs-history
```

完全不需要重新构建 `liudon.com`。

#### 随机选择一个历史快照

页面真正运行时，流程大概是这样：

```text
打开时光机页面
      ↓
同时读取 months.json 和 latest.json
      ↓
知道历史记录总数和当前最新 CID
      ↓
从全部历史快照中随机一个位置
      ↓
定位到对应月份
      ↓
读取 history/YYYY-MM.jsonl
      ↓
取得对应历史记录
      ↓
排除当前最新 CID
      ↓
开始穿越
```

页面第一次只需要请求两个很小的索引文件：

```text
months.json
+
latest.json
```

`months.json` 用来描述整个历史快照池：

```text
一共有多少条历史记录
每个月分别有多少条
```

`latest.json` 则告诉页面当前最新的博客快照是哪一个。

这里特意把最新 CID 排除掉。

毕竟人现在访问的就是当前博客，如果启动一次时光机，结果又回到“现在”，那就没什么意思了。

确定随机位置以后，页面再去请求对应月份的数据，例如：

```text
history/2026-09.jsonl
```

也就是说，一次穿越通常只需要读取：

```text
2 个很小的索引 JSON
+
1 个当月 JSONL
```

不需要把所有历史数据一次性加载到浏览器。

历史记录以后就算继续增长，这个流程也不会有太大变化。

#### iframe 加载过去的博客

随机到某一条历史记录以后，就拿到了对应的 CID。

例如：

```text
bafybeigq6ysku5e6uy4ahh2yodgpj3zvrioxt374d5amt3onsvjrcwloai
```

对应的历史博客地址就是：

```text
https://liudon.xyz/ipfs/<CID>/
```

不过这里并没有直接把整个页面跳转过去。

时光机页面本身还保留着一个全屏的 `iframe`。

随机出 CID 以后，只需要把：

```text
https://liudon.xyz/ipfs/<CID>/
```

设置成这个 `iframe` 的地址。

于是：

```text
liudon.com/time/
        │
        ▼
     时光机页面
        │
        ▼
随机得到历史 CID
        │
        ▼
iframe 加载
liudon.xyz/ipfs/<CID>/
        │
        ▼
   显示过去的博客
```

这样用户实际上始终没有离开时光机页面。

历史博客负责占满页面主体，而时光机自己的控制面板仍然保留在上面。

穿越完成以后，可以看到当前快照对应的时间，也可以继续：

```text
🎲 再次随机
```

或者：

```text
↩ 回到现在
```

所以整个实现说白了，就是：

**随机挑一个过去的 CID，再把它加载到时光机页面里的 `iframe`。**

#### 加点时光穿梭的感觉

现在时光机页面打开以后，就会自动开始随机。

如果拿到 CID 以后，马上把：

```text
https://liudon.xyz/ipfs/<CID>/
```

塞进 iframe 显示出来，那这个功能看起来其实还是很像：

随机打开了一个网页。

虽然功能已经实现了，但“时光机”的感觉还是差一点。

既然名字都叫时光机了，还是得稍微做点仪式感。

所以页面中间加了一段简单的“穿越过程”。

比如：

```text id="full-62"
BLOG TIME MACHINE

locating a point in blog history...
reading immutable snapshots...
time coordinate locked...
travelling...
```

等一下，再让历史页面慢慢显示出来。

同时为了让“穿越”看起来更像那么回事，我还给历史页面加了一层从模糊到清晰的过渡效果。

随机到历史 CID 后，并不会马上把页面完整显示出来，而是先让 `iframe` 中的历史博客以模糊、半透明的状态出现，再慢慢恢复清晰。

整个感觉有点像：

```text
正在穿越
   ↓
过去的页面逐渐出现
   ↓
画面从模糊变清晰
   ↓
抵达过去
```

本质上只是一些 CSS 过渡效果，没有什么复杂技术，但配合前面的终端文字和加载过程，整个“时光机”的感觉会完整很多。

这部分当然没有任何技术价值。

纯粹就是：

**为了好玩。**

本来这个功能的出发点也不是解决什么严肃需求。

那就干脆做得像个小玩具一点。

打开时光机。

不知道会去哪。

看着页面跑几行字。

然后过去某一次博客发布的页面慢慢出现在眼前。

这样才比较像“时光机”。

### 最后，把两条流程串起来

现在整个方案其实可以分成两个阶段。

#### 发布博客的时候

```text id="full-63"
Git Push
   ↓
GitHub Actions
   ↓
Hugo Build
   ↓
public/
   │
   ├────────→ 正常部署
   │             ↓
   │         liudon.com
   │
   └────────→ IPFS
                 ↓
                CID
                 ↓
         写入 ipfs-history
                 ↓
       history/YYYY-MM.jsonl
                 +
            months.json
```

#### 玩时光机的时候

```text id="full-64"
打开 Hugo 静态页面
        ↓
读取 months.json + latest.json
        ↓
从全部历史快照中随机一个
        ↓
读取对应月份的 JSONL
        ↓
取得 CID
        ↓
播放穿越效果
        ↓
iframe 加载 IPFS Gateway
        ↓
显示过去的博客
```

整个过程中没有：

* 数据库；
* 动态后端；
* 历史查询 API；
* 专门的版本管理服务。

用到的还是博客本身已有的东西：

```text id="full-65"
Hugo
+
GitHub Actions
+
Git
+
IPFS
+
一点 JavaScript
```

最后拼出来这么一个小功能。

## 总结

最开始把博客内容托管到 IPFS，更多还是为了折腾。

当时看到网站真的能从 IPFS 上完整跑起来，还是挺有意思的。

但折腾完成以后，IPFS 和博客本身其实并没有真正产生联系。

对于平时访问博客的人来说：

```text id="full-66"
有没有 IPFS
```

没有任何区别。

直到后来想到：

> 每一次发布产生的 CID，本身不就是一个博客历史快照吗？

于是把这些原本孤立的 CID 记录下来，再随机选一个跳回去。

时光机就这么出来了。

它没有解决什么特别重要的问题。

不会提高博客性能。

不会提高 SEO。

甚至从实用角度来说，一个历史版本列表可能都比它更有用。

但我最后还是没有做列表。

因为：

> **列表是拿来查东西的，时光机是拿来玩的。**

点一下。

不知道会回到什么时候。

看看以前的首页。

看看过去写过的文章。

偶尔还能看到一些自己已经忘记的东西。

点击[时光机](https://liudon.com/time)，看看它会带你回到哪一天吧。
