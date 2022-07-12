---
title: "Golang解析json的一个问题"
date: 2022-05-20T21:18:23+08:00
draft: false
tags: ["golang"]
---

业务模块从`php`迁移到`golang`下了，最近遇到一个golang下json解析的问题：

    请求接口，按返回包字段判断请求成功与否。

伪代码如下：

```go
package main

import (
	"encoding/json"
	"fmt"
)

type Response struct {
	Code int    `json:"code"`
	Msg  string `json:"msg"`
}

func main() {
	// 场景1，返回包符合接口要求
	str := `{"code":100,"msg":"failed"}`
	var res Response
	json.Unmarshal([]byte(str), &res)
	fmt.Printf("res=%+v\n", res)
    // 解析正确，符合预期
	// res={Code:100 Msg:failed}

	// 场景2，返回包不符合接口要求，缺少相关字段
	str = `{"retCode":100,"retMsg":"failed"}`
	var res1 Response
	json.Unmarshal([]byte(str), &res1)
	fmt.Printf("res=%+v\n", res1)
    // 解析错误，不符合预期
	// res={Code:0 Msg:}
}
```

这里由于接口地址配置错误，导致请求到其他接口，返回包不符合协议要求。

缺少`code`字段，`Unmarshal`解析后，按默认值处理，所以`code`为0，导致验证出错。

修正方案：

将`Code`字段定义为引用类型，通过判断地址是否为`nil`来区分缺少字段的情况。

```go
package main

import (
	"encoding/json"
	"fmt"
)

type Response struct {
	Code *int   `json:"code"`
	Msg  string `json:"msg"`
}

func main() {
	// 返回包符合接口要求
	str := `{"code":100,"msg":"failed"}`
	var res Response
	json.Unmarshal([]byte(str), &res)
	fmt.Printf("res=%+v\n", res)
	// 解析正确，符合预期
	// res={Code:100 Msg:failed}

	if res.Code == nil || *res.Code > 0 {
		fmt.Println("request failed")
	}

	// 返回包不符合接口要求，缺少相关字段
	str = `{"id":1}`
	var res1 Response
	json.Unmarshal([]byte(str), &res1)
	fmt.Printf("res=%+v\n", res1)
	// 解析错误，不符合预期
	// res={Code:0 Msg:}

	if res1.Code == nil || *res1.Code > 0 {
		fmt.Println("request failed")
	}
}
```

参考资料：

[how-to-determine-if-a-json-key-has-been-set-to-null-or-not-provided](https://www.calhoun.io/how-to-determine-if-a-json-key-has-been-set-to-null-or-not-provided/)

[json-key-not-set-null-golang](https://apoorv.blog/json-key-not-set-null-golang/)