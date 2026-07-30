---

title: "Caddy 转发 GOST 报 TLS internal error 问题的排查与解决"
slug: "caddy-forward-gost-tls-internal-error"
date: 2026-07-30T10:30:00+08:00
draft: false
description: "记录 GOST 客户端通过 Caddy 转发访问 GOST 服务端时出现 TLS internal error 的排查过程，最终定位为客户端通过 IP 连接时未发送 SNI，并使用域名配合 ip 参数解决。"
summary: "GOST 客户端直连 GOST 服务端正常，改为经 Caddy 转发后却报 tls: internal error。本文通过 tshark 抓包定位 TLS 握手失败原因，并给出 domain + ip 参数和 default_sni 两种解决方案。"
tags:
- Caddy
- GOST
- TLS
- SNI
- WebSocket
- tshark

---

## 问题现象

原本 GOST 服务端直接监听公网 `443`，Windows GOST 客户端通过服务器 IP 连接时可以正常使用。

后来为了让公网 `443` 端口由 Caddy 统一管理，将 GOST 调整为监听本机端口，再由 Caddy 通过域名反向代理到 GOST。

改造后，Windows GOST 客户端连接失败，并出现：

```text
remote error: tls: internal error
```

开启 GOST 调试日志后，本地代理调用方还会收到：

```text
HTTP/1.1 503 Service Unavailable
Proxy-Agent: gost/2.12.0
Content-Length: 0
```

一开始容易将问题理解为：

* Caddy 返回了 HTTP 503；
* GOST 服务端没有正常监听；
* Caddy 的 `reverse_proxy` 配置错误；
* WebSocket 路径不一致；
* 用户名或密码错误。

但后续抓包表明，请求根本没有进入 Caddy 的 HTTP 反向代理阶段，真正的错误发生在 TLS 握手过程中。

## 两种部署架构

```text
代理域名：proxy.example.com
服务器公网 IP：203.0.113.10
GOST 本地端口：127.0.0.1:10443
```

### 架构一：GOST 客户端直连 GOST 服务端

原来的部署结构如下：

```text
┌─────────────────────────┐
│ GOST Client             │
│ relay+mwss              │
│                         │
│ 连接 203.0.113.10:443   │
└────────────┬────────────┘
             │
             │ TLS
             │ WebSocket
             │ Relay
             ▼
┌─────────────────────────┐
│ GOST Server             │
│ relay+mwss              │
│                         │
│ 监听 0.0.0.0:443        │
│ GOST 自己处理 TLS       │
└─────────────────────────┘
```

GOST 服务端示例：

```bash
docker run -d \
  --name gost \
  --restart unless-stopped \
  --network host \
  -v "${CERT_DIR}:${CERT_DIR}:ro" \
  ginuerzh/gost \
  -L "relay+mwss://${USER}:${PASS}@0.0.0.0:443?cert=${CERT}&key=${KEY}"
```

客户端使用服务器 IP 连接：

```bash
-F "relay+mwss://user:password@203.0.113.10:443?host=proxy.example.com&sni=proxy.example.com"
```

在这一架构下连接正常。

### 架构二：GOST 客户端通过 Caddy 访问 GOST

调整后的部署结构如下：

```text
┌─────────────────────────┐
│ GOST Client             │
│ relay+mwss              │
│                         │
│ 连接 Caddy 公网 443     │
└────────────┬────────────┘
             │
             │ TLS
             │ WebSocket
             ▼
┌─────────────────────────┐
│ Caddy                   │
│                         │
│ 监听公网 :443           │
│ 终止 TLS                │
│ 根据域名选择站点        │
└────────────┬────────────┘
             │
             │ 明文 WebSocket
             ▼
┌─────────────────────────┐
│ GOST Server             │
│ relay+mws               │
│                         │
│ 127.0.0.1:10443         │
└─────────────────────────┘
```

此时 TLS 由 Caddy 处理：

```text
客户端 → Caddy：relay+mwss
Caddy → GOST：relay+mws
```

GOST 服务端改为：

```bash
docker run -d \
  --name gost \
  --restart unless-stopped \
  --network host \
  ginuerzh/gost \
  -L "relay+mws://${USER}:${PASS}@127.0.0.1:10443"
```

Caddy 配置为：

```caddyfile
proxy.example.com {
	reverse_proxy 127.0.0.1:10443
}
```

客户端仍然使用原来的 IP 连接方式：

```bash
-F "relay+mwss://user:password@203.0.113.10:443?host=proxy.example.com&sni=proxy.example.com"
```

此时开始出现：

```text
remote error: tls: internal error
```

## 排查过程

### 确认 SNI 和 Host 所在的阶段

一次 `mwss` 连接大致经过：

```text
1. 建立 TCP 连接
2. 发送 TLS ClientHello
3. 在 ClientHello 中携带 SNI
4. 完成 TLS 握手
5. 发送 WebSocket HTTP 请求
6. 在 HTTP 请求中携带 Host
7. 进行 GOST Relay 握手
```

因此：

```text
SNI：在 TLS 握手阶段发送
Host：在 TLS 完成后的 HTTP 请求中发送
```

如果 TLS 阶段已经失败，那么客户端配置中的：

```text
host=proxy.example.com
```

根本没有机会发送到 Caddy。

这意味着排查时不能只看客户端命令行参数，还必须确认它实际发出的 TLS ClientHello 中是否存在 SNI。

### 使用 curl 验证 Caddy 本身

先使用 `curl` 强制将域名解析到指定服务器 IP：

```powershell
curl.exe -vk `
  --resolve proxy.example.com:443:203.0.113.10 `
  https://proxy.example.com/
```

如果能正常完成 TLS 并返回类似：

```text
HTTP/2 404
```

说明以下部分基本正常：

* 公网 `443` 可达；
* Caddy 正在监听；
* Caddy 管理的证书可用；
* `proxy.example.com` 站点能够正确匹配；
* 使用域名作为 SNI 时，TLS 握手可以完成。

这里返回 `404` 并不代表 GOST 有问题。

普通 `curl` 请求不是合法的 GOST WebSocket 请求，因此返回普通 HTTP 错误是正常现象。这个测试的目的只是验证 Caddy 的 TLS 和站点匹配。

### 使用 tshark 检查客户端是否发送 SNI

安装 `tshark`：

```bash
sudo apt update
sudo apt install -y tshark
```

实时查看访问公网 `443` 的 TLS ClientHello：

```bash
sudo tshark \
  -i any \
  -f 'tcp port 443' \
  -Y 'tls.handshake.type == 1' \
  -T fields \
  -e ip.src \
  -e tcp.srcport \
  -e tls.handshake.extensions_server_name
```

启动 Windows GOST 客户端后，输出类似：

```text
198.51.100.25    17619
198.51.100.25    17620
```

最后一列本应显示：

```text
proxy.example.com
```

但实际为空。

这说明客户端真实发送的是：

```text
TCP 目标：203.0.113.10:443
TLS SNI：空
```

虽然客户端参数里配置了：

```text
sni=proxy.example.com
```

但在当前使用的 GOST v2.12.0 和 `relay+mwss` 组合下，该参数没有真正进入 TLS ClientHello。

### 抓取完整请求确认失败位置

为了确认请求是否进入 GOST 后端，可以同时抓取公网 `443` 和本机 `10443`：

```bash
sudo tshark \
  -i any \
  -f 'tcp port 443 or tcp port 10443' \
  -w /tmp/gost-test.pcapng
```

客户端连接一次，出现错误后停止抓包。

查看 TLS ClientHello：

```bash
sudo tshark \
  -r /tmp/gost-test.pcapng \
  -Y 'tcp.dstport == 443 && tls.handshake.type == 1' \
  -T fields \
  -e frame.number \
  -e frame.time \
  -e ip.src \
  -e tcp.srcport \
  -e tls.handshake.extensions_server_name
```

结果类似：

```text
16  Jul 30, 2026 09:56:08.224178672 CST  198.51.100.25  17619
26  Jul 30, 2026 09:56:08.466286059 CST  198.51.100.25  17620
```

SNI 字段仍然为空。

接着查看 Caddy 是否向 GOST 后端发送了请求：

```bash
sudo tshark \
  -r /tmp/gost-test.pcapng \
  -Y 'tcp.dstport == 10443 && http.request' \
  -T fields \
  -e frame.number \
  -e frame.time \
  -e http.request.method \
  -e http.host \
  -e http.request.uri \
  -e http.upgrade
```

没有任何输出。

这说明请求没有进入：

```text
127.0.0.1:10443
```

也就是 Caddy 尚未执行：

```caddyfile
reverse_proxy 127.0.0.1:10443
```

连接就已经失败。

### 查看 TLS Alert

继续查看 TLS Alert：

```bash
sudo tshark \
  -r /tmp/gost-test.pcapng \
  -Y 'tls.alert_message' \
  -T fields \
  -e frame.number \
  -e frame.time \
  -e ip.src \
  -e ip.dst \
  -e tls.alert_message
```

输出类似：

```text
18  Jul 30, 2026 09:56:08.224555864 CST  203.0.113.10  198.51.100.25  1
28  Jul 30, 2026 09:56:08.466625388 CST  203.0.113.10  198.51.100.25  1
```

查看其中一个数据包的详细内容：

```bash
sudo tshark \
  -r /tmp/gost-test.pcapng \
  -Y 'frame.number == 18' \
  -V
```

可以看到：

```text
Transport Layer Security
    TLSv1.2 Record Layer: Alert
        Level: Fatal
        Description: Internal Error
```

完整失败路径已经明确：

```text
Windows GOST
→ 连接 203.0.113.10:443
→ ClientHello 没有 SNI
→ Caddy 在 TLS 阶段返回 Fatal Internal Error
→ 未进入 HTTP/WebSocket
→ 未转发到 127.0.0.1:10443
→ Windows 本地 GOST 返回 HTTP 503
```

## 解决方案

### 推荐方案：域名作为节点地址，使用 ip 指定实际服务器

推荐将客户端配置改为：

```bash
-F "relay+mwss://user:password@proxy.example.com:443?ip=203.0.113.10"
```

这里将两个概念分开：

```text
proxy.example.com：
- 用于 TLS SNI
- 用于 WebSocket Host

203.0.113.10：
- 用于实际建立 TCP 连接
```

客户端实际行为变为：

```text
TCP 连接目标：203.0.113.10:443
TLS SNI：proxy.example.com
WebSocket Host：proxy.example.com
```

这相当于只为当前 GOST 节点指定了一个固定 IP，但不会修改系统 hosts，也不会依赖该域名当前的公共 DNS 解析结果。

Caddy 不需要任何特殊兼容配置：

```caddyfile
proxy.example.com {
	reverse_proxy 127.0.0.1:10443
}
```

### 兼容方案：Caddy 设置 default_sni

如果客户端无法调整，仍然只能使用 IP 作为节点地址：

```bash
-F "relay+mwss://user:password@203.0.113.10:443?host=proxy.example.com&sni=proxy.example.com"
```

可以在 Caddy 中配置：

```caddyfile
{
	default_sni proxy.example.com
}

proxy.example.com {
	reverse_proxy 127.0.0.1:10443
}
```

`default_sni` 的作用是：

```text
当客户端完全没有发送 SNI 时，
Caddy 将连接按 proxy.example.com 处理。
```

这样即使客户端 ClientHello 中的 SNI 为空，Caddy 仍可以选择对应证书并完成 TLS 握手。

不过，这种方式更适合作为旧客户端或特殊客户端的兼容方案。

注意：通过 default_sni 的方式兼容，则不能开启 strict_sni_host 校验，否则会导致校验失败出现TLS错误。

## 总结

这次故障的直接原因是：

```text
GOST 客户端使用服务器 IP 作为 relay+mwss 节点地址时，
配置中的 sni 参数没有真正进入 TLS ClientHello。
```

抓包结果显示：

```text
TLS SNI：空
TLS Alert：Fatal Internal Error
GOST 后端 10443：没有任何请求
```

因此可以排除：

* GOST 后端监听异常；
* Caddy 到 GOST 的反向代理异常；
* WebSocket Host 或路径异常；
* 用户名密码错误。

请求在进入这些阶段之前，就已经在 Caddy 的 TLS 握手处失败。

两种架构表现不同，关键在于谁负责处理公网 TLS。

在 GOST 客户端直连 GOST 服务端的架构中：

```text
客户端
→ GOST :443
```

公网 `443` 只有一个 GOST TLS 监听器。

GOST 不需要根据 SNI 区分多个 HTTPS 站点，即使客户端不发送 SNI，请求也仍然会进入这个唯一监听器，因此连接可以成功。

而在 Caddy 转发 GOST 的架构中：

```text
客户端
→ Caddy :443
→ GOST 127.0.0.1:10443
```

公网 TLS 由 Caddy 处理。

Caddy 需要在 TLS ClientHello 阶段根据 SNI 选择：

* 对应的站点；
* 对应的 TLS 证书；
* 后续的 HTTP 路由。

当客户端没有发送 SNI 时，Caddy 无法正常完成对应域名的 TLS 处理，于是在 WebSocket Host、Relay 认证和反向代理发生之前，直接返回：

```text
Fatal Internal Error
```
