---
title: "一次 GitHub Actions 超时，追到 IPFS 基础设施的动荡"
date: 2026-10-09T11:08:15+08:00
draft: false
tags:
  - IPFS
  - GitHub Actions
  - Hugo
  - 博客优化
keywords:
  - dist.ipfs.tech
  - IPFS 部署失败
  - GitHub Actions IPFS
  - ipfs-deploy-action
  - IPFS Kubo
description: "一次博客 GitHub Actions 部署失败排查：从 Create IPFS CAR 阶段的 dist.ipfs.tech 连接异常，一路追到第三方 Action 的间接依赖，以及 Shipyard 停止 IPFS 维护后的基础设施变化。"
---

## 前言

今天更新《[博客时光机 2.0 前端篇：把时间装进一台 Macintosh](/posts/hugo-ipfs-time-machine-v2-frontend/)》时，突然遇到了 GitHub Actions 执行失败。

简单看了下报错，看着是 `IPFS` 部分执行失败了。

以为是偶尔遇到的网络问题，重试几次还是不行。

## 分析

博客目前的 GitHub Actions 发布流程大致是：

```text
Git Push
   ↓
GitHub Actions
   ↓
Hugo Build
   ↓
public/
   │
   ├──→ 正常部署
   │
   └──→ 生成 IPFS CAR
             ↓
        自建 Kubo
             +
          Filebase
             ↓
           IPNS
```

前面的 Hugo Build 和正常站点部署都已经成功。

失败发生在 `Create IPFS CAR` 这一阶段。

```text
Run curl --retry 5 --no-progress-meter --output "kubo/dist.json" "https://dist.ipfs.tech/kubo/v0.42.0/dist.json"

curl: (28) Failed to connect to dist.ipfs.tech port 443 after 300487 ms: Timeout was reached
Warning: Problem : timeout. Will retry in 1 seconds. 5 retries left.
curl: (28) Failed to connect to dist.ipfs.tech port 443 after 300293 ms: Timeout was reached
Warning: Problem : timeout. Will retry in 2 seconds. 4 retries left.
```

看起来是访问 `dist.ipfs.tech` 超时了，这个是 IPFS 长期使用的软件发行站点。

试了下在本地访问这个地址，也超时了。

### 为什么会访问 dist.ipfs.tech：排查 Action 依赖

workflow 里这步的配置如下：

```yaml
- name: Create IPFS CAR
  id: ipfs
  timeout-minutes: 10
  uses: ipshipyard/ipfs-deploy-action@v2
  with:
    path-to-deploy: ./public
    cid-profile: unixfs-v1-2025

    github-token: ${{ github.token }}
    upload-car-artifact: "false"
    set-github-status: "false"
    set-pr-comment: "false"
```

看起来可能是这个 `ipshipyard/ipfs-deploy-action@v2` Action 里用到了。

继续翻代码，原来在这个 Action 里面又调用了另一个 Action `ipfs/download-ipfs-distribution-action@v1`。

`ipfs/download-ipfs-distribution-action@v1` 这个 Action 里会访问 `dist.ipfs.tech` 这个地址下载安装 Kubo。

整个流程如下：

```text
我的 workflow
    ↓
ipshipyard/ipfs-deploy-action@v2
    ↓
ipfs/download-ipfs-distribution-action@v1
    ↓
dist.ipfs.tech
```

### 原来不止我遇到这个问题了

定位到不是我自己代码的原因后，在网上查了一下 `dist.ipfs.tech` 的报错情况，发现还有其他人也遇到这个问题了。

10 月 6 日，[IPFS 官方论坛](https://discuss.ipfs.tech/t/what-happens-to-ipfs-maintenance-and-public-infrastructure-after-september-30/20324)已经有人反馈：

> `dist.ipfs.tech` is dead

同一个讨论中还提到了 `ipfscluster.io` 等其他 IPFS 基础设施无法使用。

更巧的是，10 月 7 日 Cardano 的 [Mithril 项目周报](https://updates.cardano.intersectmbo.org/2026-10-07-mithril/)里，也出现了这样一项修复：

```text
IPFS e2e tests fail when dist.ipfs.tech is unreachable
```

也就是说，他们的 CI 同样因为 `dist.ipfs.tech` 无法访问而受到影响，并专门做了兼容处理。

到这里，基本排除 GitHub Actions 某个 Runner 的偶发网络问题了。

### IPFS 基础设施的动荡

2026 年 8 月 24 日，Interplanetary Shipyard 发布了一篇公告：

**[The end of IPFS at Shipyard](https://ipshipyard.com/blog/2026-the-end-of-ipfs-at-shipyard/)**

其中提到，因为 Protocol Labs 不再续资，Shipyard 将逐步结束与 IPFS 相关的工程、维护和基础设施运营。

> Our final day of our IPFS related work will be September 30, 2026.

Shipyard 的 IPFS 相关工作最终于 2026/09/30 结束。

看来这次并不只是一次偶发的网络故障，背后正好赶上了 IPFS 原有维护团队退出、部分基础设施进入交接的阶段。

## 修复：升级 ipfs-deploy-action@v3

看起来这个问题已经好几天了，只不过我一直没有更新，所以没有触发到这个问题。

这里依赖的是第三方 Action，可能已经有修复更新了。

查了一下，`ipshipyard/ipfs-deploy-action` 已经提供了 `v3` 版本：

升级了内部使用的下载 Action，Kubo 改为从 GitHub Releases 获取，不再依赖原来的 `dist.ipfs.tech` 下载链路。

不过 `v3` 版本默认把 Kubo 版本从 `v0.42.0` 升到了 `v0.43.1`。

为了控制变量，这次先不动 Kubo 版本，只解决下载链路的问题，所以显式把 Kubo 锁定在之前的 `v0.42.0`。

更新 workflow 配置：

```yaml
- name: Create IPFS CAR
  id: ipfs
  timeout-minutes: 10
  uses: ipshipyard/ipfs-deploy-action@v3 # v2 -> v3
  with:
    path-to-deploy: ./public
    cid-profile: unixfs-v1-2025
    kubo-version: v0.42.0 # 显式固定版本，避免隐式升级引入变量

    github-token: ${{ github.token }}
    upload-car-artifact: "false"
    set-github-status: "false"
    set-pr-comment: "false"
```

重跑任务，执行成功了，问题解决。👏

## 总结

之前已经遇到过一次 [IPFS 官方 Gateway 服务下线的问题](/posts/replacing-cloudflare-ipfs-gateway-with-self-hosted-gateway/)，这次又碰到 `dist.ipfs.tech` 服务无法访问。

每次都是突然发现依赖的基础设施不可用了，然后赶紧折腾修复。

真心希望 IPFS 以及这些围绕它运行的基础设施，未来还能稳定、持久地运营下去。
