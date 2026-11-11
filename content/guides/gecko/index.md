---
title: "Gecko：macOS 录屏工具开发实践"
description: "Gecko macOS 录屏工具开发实践。记录 ScreenCaptureKit 跨桌面录制的卡顿与冻结排查、Pulse 机制设计，以及录屏自动化测试与成品视频帧号分析。"
ascii: "GECKO"
date: 2026-11-11T15:55:00+08:00
weight: 4
show_meta: false
disable_comments: true
show_pagination: false
tree:
  - post: /posts/gecko-macos-app-recorder/
  - post: /posts/screencapturekit-cross-space-freeze/
  - post: /posts/gecko-adaptive-pulse-design/
  - post: /posts/gecko-recording-test-automation/
---

Gecko 是我开发的一款 macOS 原生录屏工具，基于 ScreenCaptureKit 和 AVFoundation，实现指定应用的音视频录制。

开发过程中，跨桌面录制成为最难解决的问题。从画面卡顿、冻结的排查，到利用 Pulse 改善采集，再到构建自动化测试验证录制结果，这份指南整理了 Gecko 的开发实践、问题分析与解决过程。
