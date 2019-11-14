---
title: "检测网站支持的SSL/TLS协议版本"
date: 2019-11-14T14:48:08+08:00
slug: "How-to-check-what-SSL-TLS-versions-are-available-for-a-website"
tag: ["nginx", "ssl"]
---

> Chrome 72及以上版本不支持TLS 1.0和TLS 1.1，访问TLS 1.0或1.1证书的站点会告警，但不阻止用户访问站点。

为了解决Chrome的这个问题，今天升级了下Nginx的TLS协议版本，这里记录一下如何检测支持的协议版本。

1. 检测是否支持TLSv1

    ```
    openssl s_client -connect [ip or 域名]:443 -tls1
    ```

2. 检测是否支持TLSv1.1

    ```
    openssl s_client -connect [ip or 域名]:443 -tls1_1
    ```

3. 检测是否支持TLSv1.2

    ```
    openssl s_client -connect [ip or 域名]:443 -tls1_2
    ```

参考资料：[How to check what SSL/TLS versions are available for a website?](https://support.plesk.com/hc/en-us/articles/115004991834-How-to-check-what-SSL-TLS-versions-are-available-for-a-website-)