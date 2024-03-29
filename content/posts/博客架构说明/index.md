---
title: "博客架构说明"
date: 2022-04-10T20:41:57+08:00
draft: false
---

在拿到`liudon.com`域名前，手中已有两个域名：

- liudon.org
- liudon.xyz

![两套域名说明](博客架构.png)

`liudon.org`已经不再更新，仅作归档使用。
`liudon.xyz`当时是静态博客流行，尝鲜使用。

拿到`liudon.com`域名后，怎么部署博客成了个问题。

因为`github pages`只能绑定一个自定义域名，当然可以通过创建另外一个项目，实现两套域名，但是同一个博客两个项目总感觉不太优雅。

经过一番资料查找，终于有了下面这套方案。

![博客构建流程](博客构建流程.png)

通过`github actions` 和 `netlify` 部署了两套自动化部署方案：

- `github actions`部署到`github pages`，绑定自定义域名`liudon.com`
- `netlify`部署到`ipfs`，通过`cloudfare ipfs gateway`解析到`ipfs`资源，绑定自定义域名`liudon.xyz`。

这里要说明一下，`ipfs`目前访问延迟较大，这里仅作尝鲜使用。

`hugo`的`config.toml`定义了网站域名，这里为了区分两套域名，在`netlify`部署时，对配置文件做了修改，保证两套域名访问各自页面，具体可参考[github文件内容](https://github.com/Liudon/liudon.github.io/blob/code/netlify.toml)。