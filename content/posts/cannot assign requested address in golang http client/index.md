---
title: "Golang默认Http Client导致的cannot assign requested address错误"
date: 2025-04-29T20:20:29+08:00
draft: false
tags:
- golang
---

### 问题表现

重现代码：

```
package main

import (
	"fmt"
	"io"
	"net/http"
	"time"
)

func main() {

	client := &http.Client{
		Timeout: time.Duration(3) * time.Second,
	}

	for i := 0; i < 100; i++ {
		go func() {
			for {
				req, _ := http.NewRequest(http.MethodGet, "https://baidu.com", nil)

				rsp, err := client.Do(req)
				if err != nil {
					fmt.Println("request failed", err)
					continue
				}

				rsp.Body.Close()

				body, err := io.ReadAll(rsp.Body)
				if err != nil {
					fmt.Println("read body failed", err)
					continue
				}

				fmt.Println(string(body))
			}
		}()
	}

	select {}
}
```

启动后，随着请求越来越多，很快就出现了"cannot assign requested address"错误，服务器出现大量TIME_WAIT连接。

### 问题原因


[net/http代码](https://cs.opensource.google/go/go/+/refs/tags/go1.24.2:src/net/http/client.go;l=61)

```
type Client struct {
	// Transport specifies the mechanism by which individual
	// HTTP requests are made.
	// If nil, DefaultTransport is used.
	Transport RoundTripper
```

未配置Transport时，使用默认的DefaultTransport。

```
var DefaultTransport RoundTripper = &Transport{
	Proxy: ProxyFromEnvironment,
	DialContext: defaultTransportDialContext(&net.Dialer{
		Timeout:   30 * time.Second,
		KeepAlive: 30 * time.Second,
	}),
	ForceAttemptHTTP2:     true,
	MaxIdleConns:          100,
	IdleConnTimeout:       90 * time.Second,
	TLSHandshakeTimeout:   10 * time.Second,
	ExpectContinueTimeout: 1 * time.Second,
}
```

这里指定了最大空闲连接为100，未指定单个host的最大空闲连接。

```
func (t *Transport) maxIdleConnsPerHost() int {
	if v := t.MaxIdleConnsPerHost; v != 0 {
		return v
	}
	return DefaultMaxIdleConnsPerHost
}
```

如果未配置MaxIdleConnsPerHost，则使用默认的DefaultMaxIdleConnsPerHost配置。

```
// DefaultMaxIdleConnsPerHost is the default value of [Transport]'s
// MaxIdleConnsPerHost.
const DefaultMaxIdleConnsPerHost = 2
```

这下清楚了：

100个协程，请求同一个地址，只能保留2个空闲连接，超出的请求完就会退出，产生一个TIME_WAIT；

然后再创建一个连接，请求完关闭，又产生一个TIME_WAIT，直至耗尽端口。

### 解决方案

创建Http.Client时，配置MaxIdleConnsPerHost即可。
