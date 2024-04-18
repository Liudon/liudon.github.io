---
title: "GORM增加sqlcommenter特性"
date: 2024-04-18T21:25:24+08:00
draft: false
tags:
    - gorm
    - sqlcommenter
---

什么是sqlcommenter？

> sqlcommenter is a suite of middlewares/plugins that enable your ORMs to augment SQL statements before execution, with comments containing information about the code that caused its execution. This helps in easily correlating slow performance with source code and giving insights into backend database performance. In short it provides some observability into the state of your client-side applications and their impact on the database’s server-side.

`GORM`提供了[hints组件](https://github.com/go-gorm/hints)，可以支持`sqlcommenter`。

```
import "gorm.io/hints"

DB.Clauses(hints.Comment("select", "master")).Find(&User{})
// SELECT /*master*/ * FROM `users`;

DB.Clauses(hints.CommentBefore("insert", "node2")).Create(&user)
// /*node2*/ INSERT INTO `users` ...;

DB.Clauses(hints.CommentAfter("select", "node2")).Create(&user)
// /*node2*/ INSERT INTO `users` ...;

DB.Clauses(hints.CommentAfter("where", "hint")).Find(&User{}, "id = ?", 1)
// SELECT * FROM `users` WHERE id = ? /* hint */
```

但是需要在每个执行语句里引入类似`.Clauses(hints.CommentBefore("insert", "node2"))`代码。

我希望是全局增加`sqlcommenter`，业务侧不需要过多调整。

完整代码如下：

```
plugins/gorm.go

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
    // 注意这里一定要是Expression，因为Expression为nil的话，是不会触发Build方法执行的
    // 这里一开始参考hints注册的BeforeExpression，导致Build未执行，直到把整个gorm流程梳理一遍才发现问题所在
	clause.Expression = c
	stmt.Clauses[c.Name()] = clause
}

var extraClause = []string{"COMMENT"}

type CommentClausePlugin struct{}

// NewCommentClausePlugin create a new ExtraPlugin
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
	db.Callback().Create().Before("gorm:create").Register("CommentClausePlugin", AddAnnotation)
	db.Callback().Delete().Before("gorm:delete").Register("CommentClausePlugin", AddAnnotation)
	db.Callback().Query().Before("gorm:query").Register("CommentClausePlugin", AddAnnotation)
	db.Callback().Update().Before("gorm:update").Register("CommentClausePlugin", AddAnnotation)
	db.Callback().Raw().Before("gorm:raw").Register("CommentClausePlugin", AddAnnotation)
	db.Callback().Row().Before("gorm:row").Register("CommentClausePlugin", AddAnnotation)

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
		db.Statement.SQL.WriteString(fmt.Sprintf("%s %s", content, oldSQL))
		return
	}

	db.Statement.AddClause(Comment{Content: content})
}

// initClauses init SQL clause
func initClauses(db *gorm.DB) {
	if db.Error != nil {
		return
	}
	createClause := append(extraClause, db.Callback().Create().Clauses...)
	deleteClause := append(extraClause, db.Callback().Delete().Clauses...)
	queryClause := append(extraClause, db.Callback().Query().Clauses...)
	updateClause := append(extraClause, db.Callback().Update().Clauses...)
	rawClause := append(extraClause, db.Callback().Raw().Clauses...)
	rowClause := append(extraClause, db.Callback().Row().Clauses...)
	db.Callback().Create().Clauses = createClause
	db.Callback().Delete().Clauses = deleteClause
	db.Statement.Callback().Query().Clauses = queryClause
	db.Callback().Update().Clauses = updateClause
	db.Callback().Raw().Clauses = rawClause
	db.Callback().Row().Clauses = rowClause
}


main.go
package main

import (
    "plugins"

	gorm "gorm.io/gorm"
)


type Product struct {
  gorm.Model
  Code  string
  Price uint
}

func main() {
    dsn := "user:pass@tcp(127.0.0.1:3306)/dbname?charset=utf8mb4&parseTime=True&loc=Local"
    db, err := gorm.Open(mysql.Open(dsn), &gorm.Config{})

    db.Use(plugins.NewCommentClausePlugin())

    db.Create(&Product{Code: "D42", Price: 100})
}
```

阻塞了两天的问题，终于解决了！😁😁😁

[how gorm generates sql](https://liudon.com/posts/how-gorm-generates-sql/)
