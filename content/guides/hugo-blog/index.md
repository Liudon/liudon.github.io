---
title: "Hugo 博客搭建、部署与优化实践"
description: "基于本站长期维护经验整理的 Hugo 博客实践指南。涵盖主题改造、图片优化、Cloudflare Pages 部署、访问加速、评论系统与搜索收录。"
ascii: "HUGO"
date: 2026-09-27T00:00:00+08:00
weight: 1
show_meta: false
disable_comments: true
show_pagination: false
tree:
  - post: /posts/blog-refresh

  - name: "性能优化"
    posts:
      - /posts/fix blog cls
      - /posts/hugo auto generate image width and height
      - /posts/Responsive and optimized images with Hugo
      - /posts/Use AVIF to Optimize Images on Hugo
      - /posts/blog-performance-optimization

  - name: "部署与访问"
    posts:
      - /posts/deploy blog to cloudflare pages
      - /posts/github-pages-deployment-tutorial
      - /posts/加速Cloudflare访问
      - /posts/remove cloudflare's email-decode.min.js

  - name: "评论系统"
    posts:
      - /posts/deploy twikoo on netlify
      - /posts/twikoo-2-netlify-cors
      - /posts/twikoo-jev-spam-detection
      - /posts/twikoo-comment-delay-post-submit

  - name: "SEO 与流量"
    posts:
      - /posts/How to use Google Indexing API to speed up blog indexing
      - /posts/optimize-google-analytics
      - /posts/my-google-adsense-approval-journey
---

本博客使用 Hugo 生成静态页面，并部署在 Cloudflare Pages。

长期维护过程中，我先后处理了主题改造、图片加载、访问性能、评论系统和搜索收录等问题。

这份指南汇集了相关实践，记录每次调整背后的原因、尝试过的方案，以及最终采用的实现。
