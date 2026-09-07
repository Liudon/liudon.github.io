---
title: "GORM 源码分析：从 processor.Execute 看 SQL 是如何生成的"
date: 2024-04-18T21:14:24+08:00
lastmod: 2026-09-07T00:00:00+08:00
draft: false
tags:
    - gorm
keywords:
    - GORM
    - GORM源码
    - processor.Execute
    - callbacks.go
    - GORM SQL生成
    - BuildQuerySQL
    - Statement.Build
description: "GORM 的 processor.Execute 为什么没有直接拼接 SQL？本文以 First 查询为例，从 callbacks.go 的回调入口追踪到 BuildQuerySQL、Statement.Build 和 QueryContext，解释 SQL 的生成与执行过程。"
---

在 `gorm` 下实现 [sqlcommenter](https://google.github.io/sqlcommenter/) 的过程中遇到一些问题，顺便把 GORM 从查询方法到 SQL 生成、执行的流程梳理了一遍。

如果你在阅读 GORM 源码或者 Debug 调用链时追踪到了 `callbacks.go` 中的 `func (p *processor) Execute`，可能会发现：`Execute` 本身并没有直接拼接 SQL。那么调用 `First`、`Find` 等方法后，SQL 到底是在哪里生成的？

本文以 `First` 查询为例，继续向下追踪 `Query`、`BuildQuerySQL`、`Statement.Build` 和 `Clause.Build`，看看 GORM 是如何生成并最终执行 SQL 的。

## 先看结论：GORM SQL 生成与执行主路径

以下展示普通 `First` 查询的简化主路径，省略其他回调；部分 Clause 也可能由数据库方言提供的自定义 Builder 构建。

```text
db.First(&product, 1)
  ↓
tx.callbacks.Query()       获取 query processor
  ↓
processor.Execute()       遍历 p.fns，执行已注册的回调
  ↓
gorm:query → Query()
  ├─ BuildQuerySQL()
  │    └─ Statement.Build()
  │         └─ Clause.Build() 或自定义 ClauseBuilder
  │              └─ 写入 Statement.SQL，收集 Statement.Vars
  └─ 非 DryRun 且无错误时：QueryContext() → gorm.Scan()
```

`processor.Execute` 负责准备查询上下文、执行 Callback 以及处理日志和清理工作。默认查询回调 `Query()` 调用 `BuildQuerySQL()`，再由 `Statement.Build()` 按顺序构建各个 Clause，最终将 SQL 和参数交给底层连接执行。

## 从 First 开始追踪 GORM 查询流程

### GORM 使用示例

```go
package main

import (
  "gorm.io/driver/mysql"
  "gorm.io/gorm"
)

type Product struct {
  gorm.Model
  Code  string
  Price uint
}

func main() {
  // 参考 https://github.com/go-sql-driver/mysql#dsn-data-source-name 获取详情
  dsn := "user:pass@tcp(127.0.0.1:3306)/dbname?charset=utf8mb4&parseTime=True&loc=Local"
  db, err := gorm.Open(mysql.Open(dsn), &gorm.Config{})
  if err != nil {
    panic(err)
  }

  var product Product
  if err := db.First(&product, 1).Error; err != nil { // 根据整型主键查找
    panic(err)
  }
}
```

我们以 `First` 查询为例，看一下它如何设置查询条件并进入回调执行流程。


### First 做了什么

在 [finisher_api.go](https://github.com/go-gorm/gorm/blob/master/finisher_api.go) 文件中声明了 `First` 方法。

```go
// First finds the first record ordered by primary key, matching given conditions conds
func (db *DB) First(dest interface{}, conds ...interface{}) (tx *DB) {
	// 设置 LIMIT 1 和按主键排序的 ORDER BY Clause
	tx = db.Limit(1).Order(clause.OrderByColumn{
		Column: clause.Column{Table: clause.CurrentTable, Name: clause.PrimaryKey},
	})
	// 这里如果有指定条件的话，注册一个Where类型的Clause
	if len(conds) > 0 {
		if exprs := tx.Statement.BuildCondition(conds[0], conds[1:]...); len(exprs) > 0 {
			tx.Statement.AddClause(clause.Where{Exprs: exprs})
		}
	}
	tx.Statement.RaiseErrorOnNotFound = true
	tx.Statement.Dest = dest
	return tx.callbacks.Query().Execute(tx)
}
```

`First()` 先设置 `LIMIT`、`ORDER BY` 和查询条件，再保存结果接收对象 `Dest`，最后通过 `tx.callbacks.Query().Execute(tx)` 进入 query processor。

## GORM 回调执行入口：processor.Execute

在 [gorm.go](https://github.com/go-gorm/gorm/blob/master/gorm.go) 文件中，可以找到 `tx.callbacks` 对应的字段定义。

```go
type Config struct {
	...

	callbacks  *callbacks
	cacheStore *sync.Map
}
```

[callbacks.go](https://github.com/go-gorm/gorm/blob/master/callbacks.go)
```go
// callbacks gorm callbacks manager
type callbacks struct {
	processors map[string]*processor
}

type processor struct {
	db        *DB
	Clauses   []string
	fns       []func(*DB)
	callbacks []*callback
}

type callback struct {
	name      string
	before    string
	after     string
	remove    bool
	replace   bool
	match     func(*DB) bool
	handler   func(*DB)
	processor *processor
}

// 返回query类型的processor
func (cs *callbacks) Query() *processor {
	return cs.processors["query"]
}

func (p *processor) Execute(db *DB) *DB {
	// call scopes
	for len(db.Statement.scopes) > 0 {
		db = db.executeScopes()
	}

	var (
		curTime           = time.Now()
		stmt              = db.Statement
		resetBuildClauses bool
	)

	// 注意这里的stmt.BuildClauses，后面会用到这个信息
	if len(stmt.BuildClauses) == 0 {
		stmt.BuildClauses = p.Clauses
		resetBuildClauses = true
	}

	if optimizer, ok := db.Statement.Dest.(StatementModifier); ok {
		optimizer.ModifyStatement(stmt)
	}

	// assign model values
	if stmt.Model == nil {
		stmt.Model = stmt.Dest
	} else if stmt.Dest == nil {
		stmt.Dest = stmt.Model
	}

	// parse model values
	if stmt.Model != nil {
		if err := stmt.Parse(stmt.Model); err != nil && (!errors.Is(err, schema.ErrUnsupportedDataType) || (stmt.Table == "" && stmt.TableExpr == nil && stmt.SQL.Len() == 0)) {
			if errors.Is(err, schema.ErrUnsupportedDataType) && stmt.Table == "" && stmt.TableExpr == nil {
				db.AddError(fmt.Errorf("%w: Table not set, please set it like: db.Model(&user) or db.Table(\"users\")", err))
			} else {
				db.AddError(err)
			}
		}
	}

	// assign stmt.ReflectValue
	if stmt.Dest != nil {
		stmt.ReflectValue = reflect.ValueOf(stmt.Dest)
		for stmt.ReflectValue.Kind() == reflect.Ptr {
			if stmt.ReflectValue.IsNil() && stmt.ReflectValue.CanAddr() {
				stmt.ReflectValue.Set(reflect.New(stmt.ReflectValue.Type().Elem()))
			}

			stmt.ReflectValue = stmt.ReflectValue.Elem()
		}
		if !stmt.ReflectValue.IsValid() {
			db.AddError(ErrInvalidValue)
		}
	}

	// 根据优先级执行不同callback的回调方法
	for _, f := range p.fns {
		f(db)
	}

	if stmt.SQL.Len() > 0 {
		db.Logger.Trace(stmt.Context, curTime, func() (string, int64) {
			sql, vars := stmt.SQL.String(), stmt.Vars
			if filter, ok := db.Logger.(ParamsFilter); ok {
				sql, vars = filter.ParamsFilter(stmt.Context, stmt.SQL.String(), stmt.Vars...)
			}
			return db.Dialector.Explain(sql, vars...), db.RowsAffected
		}, db.Error)
	}

	if !stmt.DB.DryRun {
		stmt.SQL.Reset()
		stmt.Vars = nil
	}

	if resetBuildClauses {
		stmt.BuildClauses = nil
	}

	return db
}
```

### processor.Execute 为什么没有直接生成 SQL？

`(*callbacks).Query()` 返回 query processor；它和后面真正处理查询的回调函数 `Query(db *gorm.DB)` 是两个不同的方法或函数。

进入 `processor.Execute()` 后，关键在于这一段：

```go
for _, f := range p.fns {
    f(db)
}
```

它会依次执行当前 processor 中已注册并排序的 Callback。默认 query processor 包含 `gorm:query`、`gorm:preload` 和 `gorm:after_query`，其中 `gorm:query` 对应的 `Query()` 负责主查询 SQL 的构建、执行和结果扫描，之后才继续执行 `Preload()` 和 `AfterQuery()`。

此外，`Execute()` 会执行 scopes，设置 Model 和 Dest，解析模型并准备反射值。下面这段则在 `Statement.BuildClauses` 为空时，提供当前 processor 的默认 Clause 构建顺序：

```go
if len(stmt.BuildClauses) == 0 {
    stmt.BuildClauses = p.Clauses
    resetBuildClauses = true
}
```

后面的 `BuildQuerySQL()` 会使用这个顺序。如果调用方已经设置了 `BuildClauses`，这里不会覆盖它。

### Debug 时为什么可能看不到 Statement.SQL？

回调执行完毕后，`Execute()` 会记录 SQL 日志，并在非 `DryRun` 模式下清空 `Statement.SQL` 和 `Statement.Vars`。因此，在 `First()` 返回后查看这两个字段，可能已经看不到刚才执行的 SQL。

调试时可以在 `QueryContext()` 调用前观察 SQL 和参数，或者使用 `DryRun` 查看构建结果。`DryRun` 会跳过这里的数据库查询，并保留 SQL 和参数。若本次执行临时设置了 `BuildClauses`，结束时也会将它恢复为空。

仅在堆栈里看到 `callbacks.go` 或 `processor.Execute`，不能据此确定报错原因，还需要结合具体错误以及它发生在模型解析、回调、查询执行还是结果扫描阶段来判断。

## GORM 默认 Query Callback 是如何注册的

接下来看看内置 Callback 的注册过程。本文使用的 MySQL 驱动会在初始化时调用 `callbacks.RegisterDefaultCallbacks()`。

[mysql.go](https://github.com/go-gorm/mysql/blob/master/mysql.go)

```go
var (
	// CreateClauses create clauses
	CreateClauses = []string{"INSERT", "VALUES", "ON CONFLICT"}
	// QueryClauses query clauses
	QueryClauses = []string{}
	// UpdateClauses update clauses
	UpdateClauses = []string{"UPDATE", "SET", "WHERE", "ORDER BY", "LIMIT"}
	// DeleteClauses delete clauses
	DeleteClauses = []string{"DELETE", "FROM", "WHERE", "ORDER BY", "LIMIT"}

	defaultDatetimePrecision = 3
)

...

func (dialector Dialector) Initialize(db *gorm.DB) (err error) {
	if dialector.DriverName == "" {
		dialector.DriverName = "mysql"
	}

	if dialector.DefaultDatetimePrecision == nil {
		dialector.DefaultDatetimePrecision = &defaultDatetimePrecision
	}

	if dialector.Conn != nil {
		db.ConnPool = dialector.Conn
	} else {
		db.ConnPool, err = sql.Open(dialector.DriverName, dialector.DSN)
		if err != nil {
			return err
		}
	}

	withReturning := false
	if !dialector.Config.SkipInitializeWithVersion {
		err = db.ConnPool.QueryRowContext(context.Background(), "SELECT VERSION()").Scan(&dialector.ServerVersion)
		if err != nil {
			return err
		}

		if strings.Contains(dialector.ServerVersion, "MariaDB") {
			dialector.Config.DontSupportRenameIndex = true
			dialector.Config.DontSupportRenameColumn = true
			dialector.Config.DontSupportForShareClause = true
			dialector.Config.DontSupportNullAsDefaultValue = true
			withReturning = checkVersion(dialector.ServerVersion, "10.5")
		} else if strings.HasPrefix(dialector.ServerVersion, "5.6.") {
			dialector.Config.DontSupportRenameIndex = true
			dialector.Config.DontSupportRenameColumn = true
			dialector.Config.DontSupportForShareClause = true
			dialector.Config.DontSupportDropConstraint = true
		} else if strings.HasPrefix(dialector.ServerVersion, "5.7.") {
			dialector.Config.DontSupportRenameColumn = true
			dialector.Config.DontSupportForShareClause = true
			dialector.Config.DontSupportDropConstraint = true
		} else if strings.HasPrefix(dialector.ServerVersion, "5.") {
			dialector.Config.DisableDatetimePrecision = true
			dialector.Config.DontSupportRenameIndex = true
			dialector.Config.DontSupportRenameColumn = true
			dialector.Config.DontSupportForShareClause = true
			dialector.Config.DontSupportDropConstraint = true
		}

		if strings.Contains(dialector.ServerVersion, "TiDB") {
			dialector.Config.DontSupportRenameColumnUnique = true
		}
	}

	// register callbacks
	callbackConfig := &callbacks.Config{
		CreateClauses: CreateClauses,
		QueryClauses:  QueryClauses,
		UpdateClauses: UpdateClauses,
		DeleteClauses: DeleteClauses,
	}

	if !dialector.Config.DisableWithReturning && withReturning {
		if !utils.Contains(callbackConfig.CreateClauses, "RETURNING") {
			callbackConfig.CreateClauses = append(callbackConfig.CreateClauses, "RETURNING")
		}

		if !utils.Contains(callbackConfig.UpdateClauses, "RETURNING") {
			callbackConfig.UpdateClauses = append(callbackConfig.UpdateClauses, "RETURNING")
		}

		if !utils.Contains(callbackConfig.DeleteClauses, "RETURNING") {
			callbackConfig.DeleteClauses = append(callbackConfig.DeleteClauses, "RETURNING")
		}
	}

	// 注册默认callback
	callbacks.RegisterDefaultCallbacks(db, callbackConfig)

	for k, v := range dialector.ClauseBuilders() {
		db.ClauseBuilders[k] = v
	}
	return
}
```

[callbacks.go](https://github.com/go-gorm/gorm/blob/master/callbacks/callbacks.go)

```go
var (
	createClauses = []string{"INSERT", "VALUES", "ON CONFLICT"}
	queryClauses  = []string{"SELECT", "FROM", "WHERE", "GROUP BY", "ORDER BY", "LIMIT", "FOR"}
	updateClauses = []string{"UPDATE", "SET", "WHERE"}
	deleteClauses = []string{"DELETE", "FROM", "WHERE"}
)

type Config struct {
	LastInsertIDReversed bool
	CreateClauses        []string
	QueryClauses         []string
	UpdateClauses        []string
	DeleteClauses        []string
}

func RegisterDefaultCallbacks(db *gorm.DB, config *Config) {
	enableTransaction := func(db *gorm.DB) bool {
		return !db.SkipDefaultTransaction
	}

	if len(config.CreateClauses) == 0 {
		config.CreateClauses = createClauses
	}
	if len(config.QueryClauses) == 0 {
		config.QueryClauses = queryClauses
	}
	if len(config.DeleteClauses) == 0 {
		config.DeleteClauses = deleteClauses
	}
	if len(config.UpdateClauses) == 0 {
		config.UpdateClauses = updateClauses
	}

    // 注册不同类型的callback
	createCallback := db.Callback().Create()
	createCallback.Match(enableTransaction).Register("gorm:begin_transaction", BeginTransaction)
	createCallback.Register("gorm:before_create", BeforeCreate)
	createCallback.Register("gorm:save_before_associations", SaveBeforeAssociations(true))
	createCallback.Register("gorm:create", Create(config))
	createCallback.Register("gorm:save_after_associations", SaveAfterAssociations(true))
	createCallback.Register("gorm:after_create", AfterCreate)
	createCallback.Match(enableTransaction).Register("gorm:commit_or_rollback_transaction", CommitOrRollbackTransaction)
	createCallback.Clauses = config.CreateClauses

	queryCallback := db.Callback().Query()
	queryCallback.Register("gorm:query", Query)
	queryCallback.Register("gorm:preload", Preload)
	queryCallback.Register("gorm:after_query", AfterQuery)
	queryCallback.Clauses = config.QueryClauses

	deleteCallback := db.Callback().Delete()
	deleteCallback.Match(enableTransaction).Register("gorm:begin_transaction", BeginTransaction)
	deleteCallback.Register("gorm:before_delete", BeforeDelete)
	deleteCallback.Register("gorm:delete_before_associations", DeleteBeforeAssociations)
	deleteCallback.Register("gorm:delete", Delete(config))
	deleteCallback.Register("gorm:after_delete", AfterDelete)
	deleteCallback.Match(enableTransaction).Register("gorm:commit_or_rollback_transaction", CommitOrRollbackTransaction)
	deleteCallback.Clauses = config.DeleteClauses

	updateCallback := db.Callback().Update()
	updateCallback.Match(enableTransaction).Register("gorm:begin_transaction", BeginTransaction)
	updateCallback.Register("gorm:setup_reflect_value", SetupUpdateReflectValue)
	updateCallback.Register("gorm:before_update", BeforeUpdate)
	updateCallback.Register("gorm:save_before_associations", SaveBeforeAssociations(false))
	updateCallback.Register("gorm:update", Update(config))
	updateCallback.Register("gorm:save_after_associations", SaveAfterAssociations(false))
	updateCallback.Register("gorm:after_update", AfterUpdate)
	updateCallback.Match(enableTransaction).Register("gorm:commit_or_rollback_transaction", CommitOrRollbackTransaction)
	updateCallback.Clauses = config.UpdateClauses

	rowCallback := db.Callback().Row()
	rowCallback.Register("gorm:row", RowQuery)
	rowCallback.Clauses = config.QueryClauses

	rawCallback := db.Callback().Raw()
	rawCallback.Register("gorm:raw", RawExec)
	rawCallback.Clauses = config.QueryClauses
}
```

查询场景最值得注意的是下面几行：

```go
queryCallback := db.Callback().Query()
queryCallback.Register("gorm:query", Query)
queryCallback.Register("gorm:preload", Preload)
queryCallback.Register("gorm:after_query", AfterQuery)
queryCallback.Clauses = config.QueryClauses
```

`Register()` 将回调信息加入 `p.callbacks`，随后由 `processor.compile()` 调用 `sortCallbacks()` 处理排序，生成 `p.fns`。因此，`Execute()` 遍历的是已经准备好的回调函数列表。

MySQL 驱动这里传入的 `QueryClauses` 是空列表，`RegisterDefaultCallbacks()` 会回退到 GORM 的默认顺序：`SELECT`、`FROM`、`WHERE`、`GROUP BY`、`ORDER BY`、`LIMIT`、`FOR`。这个列表保存到 `queryCallback.Clauses`，也就是前面的 `p.Clauses`。

这里需要区分两个概念：`p.Clauses` / `Statement.BuildClauses` 保存构建顺序，而 `Statement.Clauses` 保存具体的 Clause 内容。

## Query：连接 SQL 构建与执行

`gorm:query` 对应的回调函数是 `Query`，它在没有已有错误时调用 `BuildQuerySQL()`。构建完成后，只有在非 `DryRun` 且没有错误时，才会调用 `ConnPool.QueryContext()` 执行查询，并通过 `gorm.Scan()` 将结果写入目标对象。

[query.go](https://github.com/go-gorm/gorm/blob/master/callbacks/query.go)

```go
func Query(db *gorm.DB) {
	if db.Error == nil {
		// 调用BuildQuerySQL方法
		BuildQuerySQL(db)

		if !db.DryRun && db.Error == nil {
			rows, err := db.Statement.ConnPool.QueryContext(db.Statement.Context, db.Statement.SQL.String(), db.Statement.Vars...)
			if err != nil {
				db.AddError(err)
				return
			}
			defer func() {
				db.AddError(rows.Close())
			}()
			gorm.Scan(rows, db, 0)
		}
	}
}

func BuildQuerySQL(db *gorm.DB) {
	if db.Statement.Schema != nil {
		for _, c := range db.Statement.Schema.QueryClauses {
			db.Statement.AddClause(c)
		}
	}

	if db.Statement.SQL.Len() == 0 {
		db.Statement.SQL.Grow(100)
		clauseSelect := clause.Select{Distinct: db.Statement.Distinct}

		if db.Statement.ReflectValue.Kind() == reflect.Struct && db.Statement.ReflectValue.Type() == db.Statement.Schema.ModelType {
			var conds []clause.Expression
			for _, primaryField := range db.Statement.Schema.PrimaryFields {
				if v, isZero := primaryField.ValueOf(db.Statement.Context, db.Statement.ReflectValue); !isZero {
					conds = append(conds, clause.Eq{Column: clause.Column{Table: db.Statement.Table, Name: primaryField.DBName}, Value: v})
				}
			}

			if len(conds) > 0 {
				db.Statement.AddClause(clause.Where{Exprs: conds})
			}
		}

		if len(db.Statement.Selects) > 0 {
			clauseSelect.Columns = make([]clause.Column, len(db.Statement.Selects))
			for idx, name := range db.Statement.Selects {
				if db.Statement.Schema == nil {
					clauseSelect.Columns[idx] = clause.Column{Name: name, Raw: true}
				} else if f := db.Statement.Schema.LookUpField(name); f != nil {
					clauseSelect.Columns[idx] = clause.Column{Name: f.DBName}
				} else {
					clauseSelect.Columns[idx] = clause.Column{Name: name, Raw: true}
				}
			}
		} else if db.Statement.Schema != nil && len(db.Statement.Omits) > 0 {
			selectColumns, _ := db.Statement.SelectAndOmitColumns(false, false)
			clauseSelect.Columns = make([]clause.Column, 0, len(db.Statement.Schema.DBNames))
			for _, dbName := range db.Statement.Schema.DBNames {
				if v, ok := selectColumns[dbName]; (ok && v) || !ok {
					clauseSelect.Columns = append(clauseSelect.Columns, clause.Column{Table: db.Statement.Table, Name: dbName})
				}
			}
		} else if db.Statement.Schema != nil && db.Statement.ReflectValue.IsValid() {
			queryFields := db.QueryFields
			if !queryFields {
				switch db.Statement.ReflectValue.Kind() {
				case reflect.Struct:
					queryFields = db.Statement.ReflectValue.Type() != db.Statement.Schema.ModelType
				case reflect.Slice:
					queryFields = db.Statement.ReflectValue.Type().Elem() != db.Statement.Schema.ModelType
				}
			}

			if queryFields {
				stmt := gorm.Statement{DB: db}
				// smaller struct
				if err := stmt.Parse(db.Statement.Dest); err == nil && (db.QueryFields || stmt.Schema.ModelType != db.Statement.Schema.ModelType) {
					clauseSelect.Columns = make([]clause.Column, len(stmt.Schema.DBNames))

					for idx, dbName := range stmt.Schema.DBNames {
						clauseSelect.Columns[idx] = clause.Column{Table: db.Statement.Table, Name: dbName}
					}
				}
			}
		}

		// inline joins
		fromClause := clause.From{}
		if v, ok := db.Statement.Clauses["FROM"].Expression.(clause.From); ok {
			fromClause = v
		}

		if len(db.Statement.Joins) != 0 || len(fromClause.Joins) != 0 {
			if len(db.Statement.Selects) == 0 && len(db.Statement.Omits) == 0 && db.Statement.Schema != nil {
				clauseSelect.Columns = make([]clause.Column, len(db.Statement.Schema.DBNames))
				for idx, dbName := range db.Statement.Schema.DBNames {
					clauseSelect.Columns[idx] = clause.Column{Table: db.Statement.Table, Name: dbName}
				}
			}

			specifiedRelationsName := make(map[string]interface{})
			for _, join := range db.Statement.Joins {
				if db.Statement.Schema != nil {
					var isRelations bool // is relations or raw sql
					var relations []*schema.Relationship
					relation, ok := db.Statement.Schema.Relationships.Relations[join.Name]
					if ok {
						isRelations = true
						relations = append(relations, relation)
					} else {
						// handle nested join like "Manager.Company"
						nestedJoinNames := strings.Split(join.Name, ".")
						if len(nestedJoinNames) > 1 {
							isNestedJoin := true
							gussNestedRelations := make([]*schema.Relationship, 0, len(nestedJoinNames))
							currentRelations := db.Statement.Schema.Relationships.Relations
							for _, relname := range nestedJoinNames {
								// incomplete match, only treated as raw sql
								if relation, ok = currentRelations[relname]; ok {
									gussNestedRelations = append(gussNestedRelations, relation)
									currentRelations = relation.FieldSchema.Relationships.Relations
								} else {
									isNestedJoin = false
									break
								}
							}

							if isNestedJoin {
								isRelations = true
								relations = gussNestedRelations
							}
						}
					}

					if isRelations {
						genJoinClause := func(joinType clause.JoinType, parentTableName string, relation *schema.Relationship) clause.Join {
							tableAliasName := relation.Name
							if parentTableName != clause.CurrentTable {
								tableAliasName = utils.NestedRelationName(parentTableName, tableAliasName)
							}

							columnStmt := gorm.Statement{
								Table: tableAliasName, DB: db, Schema: relation.FieldSchema,
								Selects: join.Selects, Omits: join.Omits,
							}

							selectColumns, restricted := columnStmt.SelectAndOmitColumns(false, false)
							for _, s := range relation.FieldSchema.DBNames {
								if v, ok := selectColumns[s]; (ok && v) || (!ok && !restricted) {
									clauseSelect.Columns = append(clauseSelect.Columns, clause.Column{
										Table: tableAliasName,
										Name:  s,
										Alias: utils.NestedRelationName(tableAliasName, s),
									})
								}
							}

							exprs := make([]clause.Expression, len(relation.References))
							for idx, ref := range relation.References {
								if ref.OwnPrimaryKey {
									exprs[idx] = clause.Eq{
										Column: clause.Column{Table: parentTableName, Name: ref.PrimaryKey.DBName},
										Value:  clause.Column{Table: tableAliasName, Name: ref.ForeignKey.DBName},
									}
								} else {
									if ref.PrimaryValue == "" {
										exprs[idx] = clause.Eq{
											Column: clause.Column{Table: parentTableName, Name: ref.ForeignKey.DBName},
											Value:  clause.Column{Table: tableAliasName, Name: ref.PrimaryKey.DBName},
										}
									} else {
										exprs[idx] = clause.Eq{
											Column: clause.Column{Table: tableAliasName, Name: ref.ForeignKey.DBName},
											Value:  ref.PrimaryValue,
										}
									}
								}
							}

							{
								onStmt := gorm.Statement{Table: tableAliasName, DB: db, Clauses: map[string]clause.Clause{}}
								for _, c := range relation.FieldSchema.QueryClauses {
									onStmt.AddClause(c)
								}

								if join.On != nil {
									onStmt.AddClause(join.On)
								}

								if cs, ok := onStmt.Clauses["WHERE"]; ok {
									if where, ok := cs.Expression.(clause.Where); ok {
										where.Build(&onStmt)

										if onSQL := onStmt.SQL.String(); onSQL != "" {
											vars := onStmt.Vars
											for idx, v := range vars {
												bindvar := strings.Builder{}
												onStmt.Vars = vars[0 : idx+1]
												db.Dialector.BindVarTo(&bindvar, &onStmt, v)
												onSQL = strings.Replace(onSQL, bindvar.String(), "?", 1)
											}

											exprs = append(exprs, clause.Expr{SQL: onSQL, Vars: vars})
										}
									}
								}
							}

							return clause.Join{
								Type:  joinType,
								Table: clause.Table{Name: relation.FieldSchema.Table, Alias: tableAliasName},
								ON:    clause.Where{Exprs: exprs},
							}
						}

						parentTableName := clause.CurrentTable
						for _, rel := range relations {
							// joins table alias like "Manager, Company, Manager__Company"
							nestedAlias := utils.NestedRelationName(parentTableName, rel.Name)
							if _, ok := specifiedRelationsName[nestedAlias]; !ok {
								fromClause.Joins = append(fromClause.Joins, genJoinClause(join.JoinType, parentTableName, rel))
								specifiedRelationsName[nestedAlias] = nil
							}

							if parentTableName != clause.CurrentTable {
								parentTableName = utils.NestedRelationName(parentTableName, rel.Name)
							} else {
								parentTableName = rel.Name
							}
						}
					} else {
						fromClause.Joins = append(fromClause.Joins, clause.Join{
							Expression: clause.NamedExpr{SQL: join.Name, Vars: join.Conds},
						})
					}
				} else {
					fromClause.Joins = append(fromClause.Joins, clause.Join{
						Expression: clause.NamedExpr{SQL: join.Name, Vars: join.Conds},
					})
				}
			}

			db.Statement.AddClause(fromClause)
		} else {
			db.Statement.AddClauseIfNotExists(clause.From{})
		}

		db.Statement.AddClauseIfNotExists(clauseSelect)

		// db.Statement.BuildClauses眼熟吗？还记得前面的stmt.BuildClauses吗？
		db.Statement.Build(db.Statement.BuildClauses...)
	}
}
```

## BuildQuerySQL：准备 Clause 并进入 SQL 拼接

`BuildQuerySQL()` 的源码较长，主要根据当前 `Statement` 中的 Schema、Select、Join 等信息，补充或合并查询所需的 Clause。`First()` 等方法已经设置的查询条件也保存在 `Statement` 中，供后续构建使用。JOIN 在这里通常作为 `FROM` Clause 的一部分构建。

当 `Statement.SQL` 为空时，它会准备 SELECT、FROM 等内容，最后调用：

```go
db.Statement.AddClauseIfNotExists(clauseSelect)
db.Statement.Build(db.Statement.BuildClauses...)
```

这里的 `BuildClauses` 正是前面 `Execute()` 在需要时从 query processor 取得的构建顺序。如果已经存在 SQL，这一段不会重新拼接。

## Statement.Build：按照 Clause 顺序生成 SQL

[statement.go](https://github.com/go-gorm/gorm/blob/master/statement.go)

```go
// Build build sql with clauses names
func (stmt *Statement) Build(clauses ...string) {
	var firstClauseWritten bool

	for _, name := range clauses {
		if c, ok := stmt.Clauses[name]; ok {
			if firstClauseWritten {
				stmt.WriteByte(' ')
			}

			firstClauseWritten = true
			if b, ok := stmt.DB.ClauseBuilders[name]; ok {
				b(c, stmt)
			} else {
				c.Build(stmt)
			}
		}
	}
}
```

`Statement.Build()` 按传入的 Clause 名称顺序，在 `Statement.Clauses` 中查找对应内容。若数据库方言提供了自定义 `ClauseBuilder`，优先调用它；否则进入通用的 `Clause.Build()`。

## Clause.Build：SQL 片段是怎么拼出来的

[clause.go](https://github.com/go-gorm/gorm/blob/master/clause/clause.go)

```go
// ClauseBuilder clause builder, allows to customize how to build clause
type ClauseBuilder func(Clause, Builder)

type Writer interface {
	WriteByte(byte) error
	WriteString(string) (int, error)
}

// Builder builder interface
type Builder interface {
	Writer
	WriteQuoted(field interface{})
	AddVar(Writer, ...interface{})
	AddError(error) error
}

// Clause
type Clause struct {
	Name                string // WHERE
	BeforeExpression    Expression
	AfterNameExpression Expression
	AfterExpression     Expression
	Expression          Expression
	Builder             ClauseBuilder
}

// Build build clause
func (c Clause) Build(builder Builder) {
	if c.Builder != nil {
		c.Builder(c, builder)
	} else if c.Expression != nil {
		if c.BeforeExpression != nil {
			c.BeforeExpression.Build(builder)
			builder.WriteByte(' ')
		}

		if c.Name != "" {
			builder.WriteString(c.Name)
			builder.WriteByte(' ')
		}

		if c.AfterNameExpression != nil {
			c.AfterNameExpression.Build(builder)
			builder.WriteByte(' ')
		}

		c.Expression.Build(builder)

		if c.AfterExpression != nil {
			builder.WriteByte(' ')
			c.AfterExpression.Build(builder)
		}
	}
}
```

`Clause.Build()` 优先使用 Clause 自身的 `Builder`。没有自定义 Builder 时，它会输出 Clause 名称，并调用 `Expression.Build()` 等方法生成具体内容。

以 `SELECT` 为例，下面的 `Select` 实现负责输出字段列表或 `*`；`SELECT` 关键字则由外层 `Clause.Build()` 输出。

```go
// Select select attrs when querying, updating, creating
type Select struct {
	Distinct   bool
	Columns    []Column
	Expression Expression
}

func (s Select) Name() string {
	return "SELECT"
}

func (s Select) Build(builder Builder) {
	if len(s.Columns) > 0 {
		if s.Distinct {
			builder.WriteString("DISTINCT ")
		}

		for idx, column := range s.Columns {
			if idx > 0 {
				builder.WriteByte(',')
			}
			builder.WriteQuoted(column)
		}
	} else {
		builder.WriteByte('*')
	}
}

func (s Select) MergeClause(clause *Clause) {
	if s.Expression != nil {
		if s.Distinct {
			if expr, ok := s.Expression.(Expr); ok {
				expr.SQL = "DISTINCT " + expr.SQL
				clause.Expression = expr
				return
			}
		}

		clause.Expression = s.Expression
	} else {
		clause.Expression = s
	}
}
```

`SELECT`、`WHERE`、`FROM` 等 SQL 片段通过相应的构建方法写入 `Statement.SQL`。参数化条件的构建还会收集参数到 `Statement.Vars`，并通过数据库方言生成对应的占位符。

## SQL 最终在哪里执行？

`BuildQuerySQL()` 返回后，控制流程回到 `Query()`。在非 `DryRun` 且没有错误时，它调用：

```go
rows, err := db.Statement.ConnPool.QueryContext(
    db.Statement.Context,
    db.Statement.SQL.String(),
    db.Statement.Vars...,
)
```

这里将 SQL 字符串和参数分别传给底层连接。`Statement.SQL.String()` 中可能仍然包含占位符，并不等同于日志里已经代入参数的 SQL 展示文本。

查询成功后，`gorm.Scan()` 读取结果并填充目标对象。等 `Query()` 返回，`Execute()` 继续执行其余回调，最后处理日志和前面提到的 SQL 清理工作。

## 总结

回过头看 `db.First(&product, 1)`，可以把主要职责归纳为：

1. `First()` 设置限制、排序、条件和结果接收对象，进入 query processor。
2. `processor.Execute()` 准备 Statement 并执行已注册的 Callback，结束时处理日志与清理。
3. 默认 `gorm:query` 回调 `Query()` 调用 `BuildQuerySQL()`，准备 SQL 构建所需的 Clause。
4. `Statement.Build()` 按顺序构建各个 Clause，通过通用或自定义 Builder 写入 SQL 并收集参数。
5. 在非 `DryRun` 且没有错误时，`Query()` 通过 `QueryContext()` 执行 SQL，再扫描查询结果。

所以，追踪到 `callbacks.go` 中的 `processor.Execute` 后，可以继续沿 `p.fns` 找到 `gorm:query` 对应的 `Query()`，再进入 `BuildQuerySQL()` 和 `Statement.Build()`，定位 SQL 实际构建的位置。

看了几回源码，这次把 Callback、Statement 和 Clause 几部分串起来，总算搞清楚了一条查询 SQL 从 API 到生成、执行的主要过程。
