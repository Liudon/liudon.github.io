---
title: "sqlcommenter 原理与 GORM 实践：为 SQL 添加请求标识"
date: 2024-04-18T21:25:24+08:00
lastmod: 2026-09-07T00:00:00+08:00
draft: false
tags:
    - gorm
    - sqlcommenter
description: "sqlcommenter 如何通过 SQL 注释关联应用请求？本文介绍其基本思路，并以 GORM 插件为例，从 Context 获取请求 ID，为 SQL 自动添加注释，讲解 Callback 与自定义 Clause 的实现。"
---

sqlcommenter（SQL commenter）通过在 SQL 注释中携带应用上下文，帮助把数据库查询与发起它的代码或请求关联起来。本文以 GORM 为例，介绍如何从 Context 读取请求 ID，通过插件自动添加 SQL 注释，减少逐条修改业务查询的工作。

## sqlcommenter 是什么，能解决什么问题？

[sqlcommenter](https://google.github.io/sqlcommenter/) 是一组为 ORM 等组件提供 SQL 注释能力的中间件和插件。它将应用上下文写入查询语句，便于分析数据库性能和查询来源。

本文希望实现的效果是，在 SQL 前添加内部生成的 UUID 请求标识 `rid`：

```sql
/* rid=550e8400-e29b-41d4-a716-446655440000 */ SELECT * FROM users;
```

当数据库查询日志或慢查询日志保留这段注释，且应用日志也记录同一个 `rid` 时，就可以用它查找对应请求。添加注释本身不会自动完成日志采集、日志关联或分布式追踪。

## 本文方案与 sqlcommenter 规范的区别

[sqlcommenter 规范](https://google.github.io/sqlcommenter/spec/) 定义了键值编码、值的单引号包裹、排序和注释追加等规则。普通 SQL 注释不等于完整的 sqlcommenter 实现。

本文演示的是借鉴这一思路的 GORM 请求标识注释插件，使用前置的 `/* rid=UUID */`，没有实现完整规范，也不假定标准解析器能直接识别它。如果需要与遵循该规范的工具互通，应按规范处理注释格式。

这里约定 `rid` 由应用内部生成，格式为 UUID，并在请求开始时写入 Context。代码中的 `xx` 仅用于未传入 `rid` 时的占位，不具备唯一请求标识的作用。

## GORM hints：为单次操作添加 SQL 注释

GORM 提供了 [hints 组件](https://github.com/go-gorm/hints)，可以在指定 Clause 附近插入注释。这提供了构建 SQL 注释的能力，但不会自动读取请求上下文或完成 sqlcommenter 的序列化规则。

```go
import "gorm.io/hints"

DB.Clauses(hints.Comment("select", "master")).Find(&User{})
// SELECT /*master*/ * FROM `users`;

DB.Clauses(hints.CommentBefore("insert", "node2")).Create(&user)
// /*node2*/ INSERT INTO `users` ...;

DB.Clauses(hints.CommentAfter("where", "hint")).Find(&User{}, "id = ?", 1)
// SELECT * FROM `users` WHERE id = ? /* hint */
```

按上面的写法，需要在相应操作中显式传入 `.Clauses(...)`。我的需求是给同一个 GORM 实例上的操作统一添加请求标识，因此选择用插件注册 Callback。

## 使用 Callback 和自定义 Clause 自动添加 rid

插件分两种情况处理：SQL 尚未构建时，添加自定义 `COMMENT` Clause，并让它排在构建顺序的开头；SQL 已经存在时（例如部分原生 SQL 操作），直接在已有 SQL 前写入注释，保留原有参数。

### 插件代码：plugins/gorm.go

```go
package plugins

import (
	"fmt"

	gorm "gorm.io/gorm"
	gormclause "gorm.io/gorm/clause"
)

type Comment struct {
	Content string
}

func (c Comment) Name() string {
	return "COMMENT"
}

func (c Comment) Build(builder gormclause.Builder) {
	builder.WriteString("/* ")
	builder.WriteString(c.Content)
	builder.WriteString(" */")
}

func (c Comment) MergeClause(mergeClause *gormclause.Clause) {
}

func (c Comment) ModifyStatement(stmt *gorm.Statement) {
	clause := stmt.Clauses[c.Name()]
	// 独立 COMMENT Clause 没有自定义 Builder，需要设置 Expression 才会构建。
	// 仅设置 BeforeExpression 而让 Expression 为 nil，不会触发这里的 Build。
	clause.Expression = c
	stmt.Clauses[c.Name()] = clause
}

type CommentClausePlugin struct{}

// NewCommentClausePlugin 创建请求标识注释插件。
func NewCommentClausePlugin() *CommentClausePlugin {
	return &CommentClausePlugin{}
}

// Name plugin name
func (ep *CommentClausePlugin) Name() string {
	return "CommentClausePlugin"
}

// Initialize register BuildClauses
func (ep *CommentClausePlugin) Initialize(db *gorm.DB) (err error) {
	initClauses(db)
	if err = db.Callback().Create().Before("gorm:create").Register("CommentClausePlugin", AddAnnotation); err != nil {
		return err
	}
	if err = db.Callback().Delete().Before("gorm:delete").Register("CommentClausePlugin", AddAnnotation); err != nil {
		return err
	}
	if err = db.Callback().Query().Before("gorm:query").Register("CommentClausePlugin", AddAnnotation); err != nil {
		return err
	}
	if err = db.Callback().Update().Before("gorm:update").Register("CommentClausePlugin", AddAnnotation); err != nil {
		return err
	}
	if err = db.Callback().Raw().Before("gorm:raw").Register("CommentClausePlugin", AddAnnotation); err != nil {
		return err
	}
	if err = db.Callback().Row().Before("gorm:row").Register("CommentClausePlugin", AddAnnotation); err != nil {
		return err
	}

	return
}

func AddAnnotation(db *gorm.DB) {
	if db.Error != nil {
		return
	}

	rid := "xx"
	// 从context上下文里取rid信息
	if v, ok := db.Statement.Context.Value("rid").(string); ok {
		rid = v
	}

	content := fmt.Sprintf("rid=%s", rid)

	if db.Statement.SQL.Len() > 0 {
		oldSQL := db.Statement.SQL.String()
		db.Statement.SQL.Reset()
		db.Statement.SQL.WriteString(fmt.Sprintf("/* %s */ %s", content, oldSQL))
		return
	}

	db.Statement.AddClause(Comment{Content: content})
}

// initClauses init SQL clause
func initClauses(db *gorm.DB) {
	if db.Error != nil {
		return
	}
	createClause := append([]string{"COMMENT"}, db.Callback().Create().Clauses...)
	deleteClause := append([]string{"COMMENT"}, db.Callback().Delete().Clauses...)
	queryClause := append([]string{"COMMENT"}, db.Callback().Query().Clauses...)
	updateClause := append([]string{"COMMENT"}, db.Callback().Update().Clauses...)
	rawClause := append([]string{"COMMENT"}, db.Callback().Raw().Clauses...)
	rowClause := append([]string{"COMMENT"}, db.Callback().Row().Clauses...)
	db.Callback().Create().Clauses = createClause
	db.Callback().Delete().Clauses = deleteClause
	db.Callback().Query().Clauses = queryClause
	db.Callback().Update().Clauses = updateClause
	db.Callback().Raw().Clauses = rawClause
	db.Callback().Row().Clauses = rowClause
}


```

这里容易踩到的坑是 `Expression`：对于这个没有自定义 `Builder` 的独立 Clause，仅设置 `BeforeExpression` 还不够。需要设置 `clause.Expression = c`，通用的 `Clause.Build()` 才会继续构建内容。这也是我当时顺着 GORM SQL 生成链路排查后才定位到的问题。

另一个关键点是已有 SQL 分支必须写入完整的 `/* ... */`。如果只把 `rid=...` 拼到语句前，会得到类似 `rid=xx SELECT ...` 的错误 SQL。

## 注册插件并传入请求 Context

下面示例使用模块名 `example.com/sqlcommenter-demo`，目录下分别放置 `main.go` 和 `plugins/gorm.go`。实际项目中，将插件导入路径替换为自己的模块路径。

本次更新使用 GORM v1.25.9、MySQL 驱动 v1.5.6 和 uuid v1.6.0 验证了编译，以及查询、创建、更新、删除、原生查询和 `Exec` 的 DryRun SQL 生成结果。该验证未连接实际数据库，数据库日志是否保留注释仍需在部署环境确认。

```bash
go mod init example.com/sqlcommenter-demo
go get gorm.io/gorm@v1.25.9 gorm.io/driver/mysql@v1.5.6 github.com/google/uuid@v1.6.0
```

### main.go

```go
package main

import (
    "context"
    "example.com/sqlcommenter-demo/plugins"

    "gorm.io/driver/mysql"
    gorm "gorm.io/gorm"
    "github.com/google/uuid"
)


type Product struct {
  gorm.Model
  Code  string
  Price uint
}

func main() {
    dsn := "user:pass@tcp(127.0.0.1:3306)/dbname?charset=utf8mb4&parseTime=True&loc=Local"
    db, err := gorm.Open(mysql.Open(dsn), &gorm.Config{})
    if err != nil {
        panic(err)
    }

    if err := db.Use(plugins.NewCommentClausePlugin()); err != nil {
        panic(err)
    }

    // 演示环境建表；已有业务表时使用项目自己的迁移流程。
    if err := db.AutoMigrate(&Product{}); err != nil {
        panic(err)
    }

    // 请求入口生成 UUID，并在应用日志中记录同一个 rid。
    ctx := context.WithValue(context.Background(), "rid", uuid.New().String())
    if err := db.WithContext(ctx).Create(&Product{Code: "D42", Price: 100}).Error; err != nil {
        panic(err)
    }
}
```

替换 DSN 并确保 MySQL 数据库已创建后，运行 `go run .`。`db.Use()` 为这个 GORM 实例注册插件，`WithContext()` 则把请求标识传到当前操作；其他独立创建的 GORM 实例需要分别注册。

## 查看生成的 SQL 与使用限制

在调用数据库之前，也可以通过 `DryRun` 观察查询 SQL 和参数：

```go
var products []Product
tx := db.WithContext(ctx).Session(&gorm.Session{DryRun: true}).
    Where("code = ?", "D42").Find(&products)
if tx.Error != nil {
    panic(tx.Error)
}
fmt.Println(tx.Statement.SQL.String())
fmt.Println(tx.Statement.Vars)
```

将这段代码放到前面的 `main()` 中，并添加 `fmt` 导入。SQL 开头应包含本次 Context 中的 `rid`，条件参数仍保存在 `Statement.Vars` 中。`DryRun` 用于查看构建结果，不证明数据库端已经执行或记录了注释。

使用时需要注意：

- `rid` 来自内部 UUID 生成逻辑。示例沿用字符串 Context key `"rid"`，实际项目应与请求入口的写入方式保持一致。
- SQL 注释不改变查询条件，数据库日志是否保留它需要在实际环境确认；不要在注释中携带密码或业务敏感信息。
- 示例覆盖默认 Callback 路径。若项目替换了回调、手动指定 `BuildClauses`，或其他插件也修改 SQL，需要验证组合后的结果。
- 本文代码不提供完整 sqlcommenter 规范兼容性，也没有实现重复注释检测；不要把同一份已加注释 SQL 反复送入该逻辑。

这样就把请求 Context、GORM Callback、自定义 Clause 和最终 SQL 串起来了。阻塞了两天的问题，终于解决了！😁

关于 `processor.Execute` 如何执行回调、`Statement.Build` 如何构建 Clause，可以继续阅读：[GORM 源码分析：从 processor.Execute 看 SQL 是如何生成的](https://liudon.com/posts/how-gorm-generates-sql/)。
