---
title: "Hermes Agent v0.23.0 升级：一次安全修复，让我的 Chrome 无法启动"
date: 2026-11-06T22:20:23+08:00
draft: false
description: "Hermes Agent v0.23.0 Docker 升级后，自建 Chrome 服务因 /run/service 权限变化无法启动。从 Permission denied 入手，追查 s6 服务目录迁移及其背后的安全修复。"
tags:
  - "Hermes Agent"
  - "Docker"
  - "s6-overlay"
keywords:
  - "Hermes Agent v0.23.0"
  - "Hermes Agent Docker 升级"
  - "s6-overlay"
  - "/run/hermes-service"
  - "Chrome CDP"
---

今天看到 Hermes Agent 发布了 v0.23.0 版本，加了很多新特性。

刚好有时间，于是顺手做了一下升级。

## 从 v0.22.5 升级到 v0.23.0

我用的是 Docker 部署，升级非常简单：

1. 备份 .hermes 目录数据
2. 重新拉取 v0.23.0 镜像部署容器

一切顺利，升级后的版本信息：

```text
Hermes Agent v0.23.0 · upstream 2bd378ed
Install method: docker
```

`hermes doctor` 没有报错：

```text
All checks passed! 🎉
```

还有一个意外收获：gateway 的常驻内存从 1666 MB 降到了 582 MB，少了约 1 GB。

v0.23.0 这个版本确实包含内存方面的优化，对于我这台小内存的主机，真是一个非常大的帮助。

## 一条意外的 Permission denied

我有一个数据采集的定时任务，平时主要通过 HTTP 请求获取数据。为了应对某些页面无法直接采集的情况，我还准备了一套 Chrome CDP 方案作为备用。我自己在容器中注册了一个 s6 服务，让它启动 headless Chrome，并监听 CDP 端口。

s6 是一套轻量级的进程管理工具，可以简单理解成容器内部的服务管理器。它负责启动后台服务，并在进程意外退出时自动重启。Hermes Agent 的 Docker 镜像就使用 s6-overlay 来管理这些后台进程。

升级后，我顺手检查了一下这套 Chrome 服务，结果发现注册服务的脚本在创建目录时就失败了。

```console
$ mkdir -p /run/service/chrome-cdp
mkdir: cannot create directory '/run/service/chrome-cdp': Permission denied
```

同一套脚本在旧版本还能正常运行，升级后却直接报错。看起来，问题应该就出在这次升级上。

## 从 Permission denied 查起

看到 `Permission denied` 关键字，第一反应就是权限问题。

不过，究竟是哪里的权限变了呢？

### s6-overlay 版本变了？

对比了两个版本的 Dockerfile，发现使用的 s6-overlay 版本完全相同：

```text
v0.22.5  S6_OVERLAY_VERSION=3.2.3.0
v0.23.0  S6_OVERLAY_VERSION=3.2.3.0
```

所以不能把问题归因于 s6-overlay 版本变化。

### /run/service 的权限变了

继续查看目录的属主和权限，发现 `/run/service` 现在由 root 拥有，普通用户没有写权限。

```text
/            dev=41     root:root    0755
/run         dev=41     root:root    0755
/run/service dev=41     root:root    0755
/opt/data    dev=65025  hermes       0700
```

但旧版本同样是通过普通用户 hermes 注册服务，为什么之前可以写？

继续追查初始化逻辑才发现，旧版会在容器启动时把 `/run/service` 的所有权交给 hermes，新版本取消了这个操作。

**旧版本为什么允许 `hermes` 往 root 的扫描目录里注册服务，而新版本不允许？**

## 原来是服务管理方式变了

查看 `/run/service`，首先发现了一个新面孔：

```console
$ ls -l /run/service/
dashboard        -> /run/s6-rc/servicedirs/dashboard
main-hermes      -> /run/s6-rc/servicedirs/main-hermes
profile-gateways -> /run/s6-rc/servicedirs/profile-gateways
```

再看进程：

```console
$ ps -eo pid,user,args | grep '[s]6-svscan'
1    root    s6-svscan -d4 -- /run/service
222  hermes  s6-svscan /run/hermes-service
```

竟然有两个 `s6-svscan`：一个以 root 身份扫描 `/run/service`，另一个以 `hermes` 身份扫描 `/run/hermes-service`。

原来这次升级不是简单地改了某个目录的权限，而是把动态服务交给独立的普通用户进程管理。

### 为什么要把 root 和 hermes 的服务分开？

沿着 `profile-gateways` 服务的 `run` 脚本继续查，找到了原因，它的注释明确说明：

> 动态创建的 gateway 服务目录由 hermes 用户写入，其中的 `run`、`finish` 等脚本也可由该用户修改，因此不能再交给 root 身份的 `s6-supervise` 执行。

s6 的服务管理方式比较特别：

每个服务对应一个目录，里面放着启动脚本 `run`。它主要通过两个程序管理这些服务：

- `s6-svscan`：负责发现有哪些服务需要运行。
- `s6-supervise`：负责启动服务，并在进程退出时按规则重新启动。

简单说，一个负责发现服务，一个负责运行和管理服务。

这里的关键是：如果 `s6-supervise` 以 root 身份运行，那么它执行的 `run` 脚本也可能拥有 root 权限。

旧版为了让 Hermes 在运行时动态注册不同 profile 的 gateway，会在容器初始化阶段把 `/run/service` 的写权限交给 `hermes`。这样注册服务很方便，却留下一个风险：

**普通用户能够写入服务脚本，root 的监督进程却可能执行这些脚本。**

如果这条边界被利用，就可能形成提权路径。为了消除这个提权风险，Hermes 在 v0.23.0 中调整了服务管理方式，对应的修改是 [PR #148251：supervise profile gateways outside the root s6 scandir](https://github.com/NousResearch/hermes-agent/pull/148251)：

在 root 管理的服务中保留一个静态的 `profile-gateways` 服务，它启动后先通过 `s6-setuidgid hermes` 降权，再运行第二个 `s6-svscan`。

于是，动态服务可以继续由 `hermes` 创建，但负责监督和执行这些服务的进程也都是 `hermes` 身份。

调整前，大致是：

```text
/run/service/                 # root 的 svscan
├── main-hermes
├── dashboard
├── gateway-default           # Hermes 动态注册
└── chrome-cdp                # 我自己注册
```

调整后，服务被分成了两组：

```text
/run/service/                 # root 管理
├── main-hermes
├── dashboard
└── profile-gateways          # 启动降权后的第二个 svscan

/run/hermes-service/          # hermes 管理
├── gateway-default
└── chrome-cdp                # 自建服务应该放这里
```

### 迁移到新目录下

确认新目录归 `hermes` 所有后，把自建服务放到 `/run/hermes-service`，并通知新的 `s6-svscan` 扫描：

```console
$ mkdir -p /run/hermes-service/chrome-cdp
$ cp chrome-cdp.run /run/hermes-service/chrome-cdp/run
$ chmod +x /run/hermes-service/chrome-cdp/run
$ /command/s6-svscanctl -a /run/hermes-service
$ /command/s6-svstat /run/hermes-service/chrome-cdp
up (pid 2692 pgid 2692) 6 seconds
```

默认情况下，`s6-svscan` 启动时扫描一次目录，并不会因为后来新增了一个子目录就自动发现新服务；需要通过 `s6-svscanctl -a` 命令显式通知它重新扫描。

另外注意，`s6-svstat` 显示 `up` 只能证明被监督的进程已经启动，**不能代替 CDP 端点的就绪检查**。

对 Chrome 服务来说，还要实际请求 `/json/version`，才能确认它可供脚本使用。

## 总结

本以为只是一次简单的版本升级，没想到一个 `Permission denied`，最后追到了 Hermes 为消除提权风险而进行的服务架构调整。

排查结束后，我又翻了一遍 Hermes 的浏览器相关代码，才发现项目中已经有 `tools.browser_launcher.launch_chromium()`，可以直接管理 Chromium 的启动、CDP 端口和进程生命周期，详细分析记录在[《一次 browser_exec 调用背后：Hermes Agent 如何管理浏览器》](/posts/hermes-agent-browser-management/)这篇文章。

于是，我索性把原来自建的 Chrome s6 服务也撤掉了，改为使用 Hermes 提供的浏览器启动器。

这次的教训是：升级成功不能只看 `hermes doctor` 全绿，平时不常使用的备用功能也需要验证。
