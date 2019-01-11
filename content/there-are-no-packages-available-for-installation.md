---
title: "解决Sublime Text安装包时\"There Are No Packages Available for Installation\"的报错
date: 2019-01-11T17:13:14+08:00
---

今天安装hugofy的包时，一直遇到"There Are No Packages Available for Installation"的错误。
按网上的教程，配置host，配置代理都不起作用。

本机确定是可以访问[https://packagecontrol.io/channel_v3.json](https://packagecontrol.io/channel_v3.json)这个地址的。

然后按教程把这文件放到本地，配置channel指向本地这个文件，然后提示json解析失败。
然后检查这个文件，发现文件好像不全。然后换到其他机器curl这个地址，发现下载下来的文件确实不全，不是合法的json内容。

又搜索一番后，找到一个case。

[Package Control: There are no packages available for installation/Server Error](https://github.com/wbond/package_control/issues/1397)

原来是官方的文件下载出问题了，可以先按上面链接里的方法修改，验证可行。

```
Meanwhile, you can add
"channels": [ "https://erhan.in/channel_v3.json" ],
to Preferences > Package Settings > Package Control > Settings - User file.

This is the latest snapshot of the original JSON file from web.archive.org.
```
