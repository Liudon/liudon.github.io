---
title: "一个Curl的耗时长的问题"
date: 2019-09-04T11:07:46+08:00
tags:["php","curl"]
---

发现某个接口请求很慢，但是后端确认接口是很快的。

在机器上通过shell执行curl命令，确实很快，但是PHP代码里请求又确实很慢。

业务里用到了`Requests`这个库，一开始以为是这个库导致的问题。

在`Requests_Transport_cURL`类里断点定位了下，确实很慢，`curl_getinfo`返回的信息如下。

```
array (
  'url' => 'http://xxxxx',
  'content_type' => 'text/html',
  'http_code' => 200,
  'header_size' => 64,
  'request_size' => 305,
  'filetime' => -1,
  'ssl_verify_result' => 0,
  'redirect_count' => 0,
  'total_time' => 2.074094,
  'namelookup_time' => 2.5E-5,
  'connect_time' => 0.032107,
  'pretransfer_time' => 0.032109,
  'size_upload' => 186,
  'size_download' => 99,
  'speed_download' => 47,
  'speed_upload' => 89,
  'download_content_length' => 99,
  'upload_content_length' => 186,
  'starttransfer_time' => 2.032866,
  'redirect_time' => 0,
  'certinfo' =>
  array (
  ),
)
```

这里可以看到`starttransfer_time`时间很长。

搜索了一番，发现网上一个case，[cURL slow starttransfer_time](https://stackoverflow.com/questions/20428632/curl-slow-starttransfer-time)。

里面提供了`Expect: 100-continue`这个header，又搜索了一番这个header资料。

`curl`在发`POST`请求的时候，如果body大于1k：

1. 先追加一个`Expect: 100-continue`请求头信息，发送这个不包含 `POST` 数据的请求；
2. 如果服务器返回的响应头信息中包含Expect: 100-continue，则表示 Server 愿意接受数据，这时才 POST 真正数据给 Server；
   如果等待1s，没有收到服务器肯定或否定的应答，那么继续发起POST请求，这种会导致请求耗时变长。

在机器上抓了个包，执行下面命令。

```
注意，下面port后面的80改成实际的端口

tcpdump -A -s 0 'tcp port 80 and (((ip[2:2] - ((ip[0]&0xf)<<2)) - ((tcp[12]&0xf0)>>2)) != 0)'
```

拿到的包信息。

```
09:17:19.421587 IP xxx.54360 > xxxxx:12345: Flags [P.], seq 767181008:767181314, ack 353986709, win 115, options [nop,nop,TS val 2628114858 ecr 1424896084], length 306
E..f.m@.@...d}@.        A...XF.-.@...h....s.......
....T.0TPOST /cgi HTTP/1.1
User-Agent: php-requests/1.6
Accept: */*
Accept-Encoding: deflate, gzip
Referer: http://xxxxx:12345/cgi
Content-Length: 188
Expect: 100-continue
Content-Type: multipart/form-data; boundary=----------------------------ee2f4d848646


09:17:21.421786 IP xxx.54360 > xxxxx:12345: Flags [P.], seq 306:494, ack 1, win 115, options [nop,nop,TS val 2628115359 ecr 1424896091], length 188
E....n@.@..Md}@.        A...XF.-.B...h....s./.....
....T.0[------------------------------ee2f4d848646
Content-Disposition: form-data; name="req"

{"command":"zzz","appId":"yyyy"}
------------------------------ee2f4d848646--

09:17:21.458628 IP xxxxx:12345 > xxx.54360: Flags [P.], seq 1:118, ack 494, win 130, options [nop,nop,TS val 1424896593 ecr 2628115359], length 117
E...X.@.5.Q2    A..d}@.F..X..h.-.B......3.....
T.2Q....HTTP/1.1 200 OK
Content-Type: text/html
Content-Length: 53

{
    "data": [],
    "errno": 0,
    "error": "ok"
}
```

可以看到确实是先发了一个`100-continue`的请求，然后再发的实际`POST`请求。

在机器上执行下面的shell命令。

```
curl 'http://xxxxx:12345/cgi' -H"Expect: 100-continue" -v
```

返回如下，可以看到返回的header头里确实没有`Expect`这项。

```
* About to connect() to xxxxx port 12345 (#0)
*   Trying xxxxx...
* Connected to xxxxx (xxxxx) port 12345 (#0)
> GET /cloud_cgi HTTP/1.1
> User-Agent: curl/7.29.0
> Host: xxxxx:12345
> Accept: */*
> Expect: 100-continue
> 
< HTTP/1.1 200 OK
< Content-Type: text/html
< Content-Length: 42
< 
* Connection #0 to host xxxxx left intact
{"errno":100,"error":"参数格式错误"}
```

解决方法：

请求的时候，header里新增一项。

```
Expect:
```