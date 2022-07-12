---
title: "整理下博客的一些调整"
date: 2022-05-13T18:20:52+08:00
draft: false
tags: ["博客","收录"]
---

新域名上线一段时间了，通过`Google Search Console`发现了一些问题，整理下最近进行的一些调整。

1. 更新主题版本，展示文章tag标签
    通过对比主题作者的网站，发现使用的不是最新代码。
    
    通过调整`Github Actions`命令解决：
    ```
    - name: Checkout repository
        uses: actions/checkout@v2
      - name: Checkout submodules
        run: git submodule update --init --recursive --remote
    ```

2. 修正404页面不生效的问题
    主题是自带了404.html文件的，但是部署后没有生成对应文件。

    修改404.html文件内容后解决，具体原因没有深究，感觉是文件内容不是完整html导致。

    可参考[文件代码](https://github.com/Liudon/liudon.github.io/blob/code/layouts/404.html)

3. 两个域名导致的页面权重问题
    发现有些页面`liudon.xyz`收录后，`liudon.com`就不再收录。

    为了规避这种收录问题，将`liudon.xyz`直接301到了`liudon.com`上。

目前已调整完毕，观察后续收录情况。