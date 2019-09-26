---
title: "Swoft 框架运行分析（四） —— EventProcessor模块分析"
date: 2019-09-26T13:02:18+08:00
tags: ["Swoft"]
---

今天我们来看一下`EventProcessor`的实现。

```
/**
    * Handle event register
    * @return bool
    */
public function handle(): bool
{
    if (!$this->application->beforeEvent()) {
        CLog::warning('Stop event processor by beforeEvent return false');
        return false;
    }

    /** @var EventManager $eventManager */
    $eventManager = bean('eventManager');
    [$count1, $count2] = ListenerRegister::register($eventManager);

    CLog::info('Event manager initialized(%d listener, %d subscriber)', $count1, $count2);

    // Trigger a app init event
    Swoft::trigger(SwoftEvent::APP_INIT_COMPLETE);

    return $this->application->afterEvent();
}
```

获取`eventManager`的`Bean`实例，对应为`Swoft\Event\Manager\EventManager`类。

```
[$count1, $count2] = ListenerRegister::register($eventManager);
```

调用`ListenerRegister`类的`register`方法。

```
/**
    * @param EventManager $em
    *
    * @return array
    */
public static function register(EventManager $em): array
{
    foreach (self::$listeners as $className => $eventInfo) {
        $listener = Swoft::getSingleton($className);

        if (!$listener instanceof EventHandlerInterface) {
            throw new RuntimeException("The event listener class '{$className}' must be instanceof EventHandlerInterface");
        }

        $em->addListener($listener, $eventInfo);
    }

    foreach (self::$subscribers as $className) {
        $subscriber = Swoft::getSingleton($className);
        if (!$subscriber instanceof EventSubscriberInterface) {
            throw new RuntimeException("The event subscriber class '{$className}' must be instanceof EventSubscriberInterface");
        }

        $em->addSubscriber($subscriber);
    }

    $count1 = count(self::$listeners);
    $count2 = count(self::$subscribers);
    // Clear data
    self::$listeners = self::$subscribers = [];

    return [$count1, $count2];
}
```

遍历`ListenerRegister`类下的`$listeners`和`$subscribers`属性，绑定事件到`eventManager`的`Bean`实例上。

这里的`$listeners`和`$subscribers`是从哪里来的呢？

这里以`http-server`为例。

在`swoft-component-2.0.5\src\http-server\src\Listener`目录下，存在下面三个文件。

```
AfterRequestListener.php
AppInitCompleteListener.php
BeforeRequestListener.php
```

这里我们以`AppInitCompleteListener.php`为例。

```
<?php

namespace Swoft\Http\Server\Listener;

use function bean;
use ReflectionException;
use Swoft\Bean\Exception\ContainerException;
use Swoft\Event\Annotation\Mapping\Listener;
use Swoft\Event\EventHandlerInterface;
use Swoft\Event\EventInterface;
use Swoft\Http\Server\Exception\HttpServerException;
use Swoft\Http\Server\Middleware\MiddlewareRegister;
use Swoft\Http\Server\Router\Router;
use Swoft\Http\Server\Router\RouteRegister;
use Swoft\SwoftEvent;

/**
 * Class AppInitCompleteListener
 * @since 2.0
 *
 * @Listener(SwoftEvent::APP_INIT_COMPLETE)
 */
class AppInitCompleteListener implements EventHandlerInterface
{
    /**
     * @param EventInterface $event
     *
     * @throws ContainerException
     * @throws ReflectionException
     * @throws HttpServerException
     */
    public function handle(EventInterface $event): void
    {
        /** @var Router $router Register HTTP routes */
        $router = bean('httpRouter');

        RouteRegister::registerRoutes($router);

        // Register middleware
        MiddlewareRegister::register();
    }
}
```

可以看到这里通过`@Listener(SwoftEvent::APP_INIT_COMPLETE)`，使用了`Swoft\Event\Annotation\Mapping\Listener`类注解，对应的注解解析类为`Swoft\Event\Annotation\Parser\ListenerParser`。

```
<?php declare(strict_types=1);

namespace Swoft\Event\Annotation\Parser;

use Doctrine\Common\Annotations\AnnotationException;
use Swoft\Annotation\Annotation\Mapping\AnnotationParser;
use Swoft\Annotation\Annotation\Parser\Parser;
use Swoft\Bean\Annotation\Mapping\Bean;
use Swoft\Event\Annotation\Mapping\Listener;
use Swoft\Event\ListenerRegister;

/**
 * Class ListenerParser
 *
 * @since 2.0
 *
 * @AnnotationParser(Listener::class)
 */
class ListenerParser extends Parser
{
    /**
     * @param int      $type
     * @param Listener $annotation
     *
     * @return array
     * @throws AnnotationException
     */
    public function parse(int $type, $annotation): array
    {
        if ($type !== self::TYPE_CLASS) {
            throw new AnnotationException('`@Listener` must be defined on class!');
        }

        // collect listeners
        ListenerRegister::addListener($this->className, [
            // event name => listener priority
            $annotation->getEvent() => $annotation->getPriority()
        ]);

        return [$this->className, $this->className, Bean::SINGLETON, ''];
    }
}
```

```
/**
    * @param string $className
    * @param array  $definition [event name => listener priority]
    */
public static function addListener(string $className, array $definition = []): void
{
    // Collect listeners
    self::$listeners[$className] = $definition;
}
```

可以看到这里通过`ListenerRegister::addListener`方法，往`ListenerRegister`上注册了`$listeners`属性。

属性`$listeners`和`$subscribers`的值，都是通过注解解析得来。

这里我们回到`EventProcessor`类的`handle`方法。

```
// Trigger a app init event
Swoft::trigger(SwoftEvent::APP_INIT_COMPLETE);
```

trigger的方法定义如下。

```
/**
    * Trigger an swoft application event
    *
    * @param string|EventInterface $event eg: 'app.start' 'app.stop'
    * @param null|mixed            $target
    * @param array                 $params
    *
    * @return EventInterface
    */
public static function trigger($event, $target = null, ...$params): EventInterface
{
    /** @see EventManager::trigger() */
    return BeanFactory::getSingleton('eventManager')->trigger($event, $target, $params);
}
```

这里调用了`eventManager`这个`Bean`实例的`trigger`方法。

```
/**
    * Trigger an event. Can accept an EventInterface or will create one if not passed
    *
    * @param string|EventInterface $event  'app.start' 'app.stop'
    * @param mixed|string          $target It is object or string.
    * @param array|mixed           $args
    *
    * @return EventInterface
    * @throws InvalidArgumentException
    */
public function trigger($event, $target = null, array $args = []): EventInterface
{
    if ($isString = is_string($event)) {
        $name = trim($event);
    } elseif ($event instanceof EventInterface) {
        $name = trim($event->getName());
    } else {
        throw new InvalidArgumentException('Invalid event params for trigger event handler');
    }

    $shouldCall = [];

    // Have matched listener
    if (isset($this->listenedEvents[$name])) {
        $shouldCall[$name] = '';
    }

    // Like 'app.db.query' => prefix: 'app.db'
    if ($pos = strrpos($name, '.')) {
        $prefix = substr($name, 0, $pos);

        // Have a wildcards listener. eg 'app.db.*'
        $wildcardEvent = $prefix . '.*';
        if (isset($this->listenedEvents[$wildcardEvent])) {
            $shouldCall[$wildcardEvent] = substr($name, $pos + 1);
        }
    }

    // Not found listeners
    if (!$shouldCall) {
        return $isString ? $this->basicEvent : $event;
    }

    /** @var EventInterface $event */
    if ($isString) {
        $event = $this->events[$name] ?? $this->basicEvent;
    }

    // Initial value
    $event->setName($name);
    $event->setParams($args);
    $event->setTarget($target);
    $event->stopPropagation(false);

    // Notify event listeners
    foreach ($shouldCall as $name => $method) {
        $this->triggerListeners($this->listeners[$name], $event, $method);

        if ($event->isPropagationStopped()) {
            return $event;
        }
    }

    // Have global wildcards '*' listener.
    if (isset($this->listenedEvents['*'])) {
        $this->triggerListeners($this->listeners['*'], $event);
    }

    return $event;
}
```

如果存在对应的事件，调用`triggerListeners`方法。

```
/**
    * @param array|ListenerQueue $listeners
    * @param EventInterface      $event
    * @param string              $method
    */
protected function triggerListeners($listeners, EventInterface $event, string $method = ''): void
{
    // $handled = false;
    $name     = $event->getName();
    $callable = false === strpos($name, '.');

    // 循环调用监听器，处理事件
    foreach ($listeners as $listener) {
        if ($event->isPropagationStopped()) {
            break;
        }

        if (is_object($listener)) {
            if ($listener instanceof EventHandlerInterface) {
                $listener->handle($event);
            } elseif ($method && method_exists($listener, $method)) {
                $listener->$method($event);
            } elseif ($callable && method_exists($listener, $name)) {
                $listener->$name($event);
            } elseif (method_exists($listener, '__invoke')) {
                $listener($event);
            }
        } elseif (is_callable($listener)) {
            $listener($event);
        }
    }
}
```

遍历事件回调，执行对应方法。

回到`EventProcessor`类的`handle`方法。

```
// Trigger a app init event
Swoft::trigger(SwoftEvent::APP_INIT_COMPLETE);
```

这里的事件为`SwoftEvent::APP_INIT_COMPLETE`，所以这里会执行这个事件下的所有回调。

这里以`Swoft\Http\Server\Listener\AppInitCompleteListener`为例。

```
<?php

namespace Swoft\Http\Server\Listener;

use function bean;
use ReflectionException;
use Swoft\Bean\Exception\ContainerException;
use Swoft\Event\Annotation\Mapping\Listener;
use Swoft\Event\EventHandlerInterface;
use Swoft\Event\EventInterface;
use Swoft\Http\Server\Exception\HttpServerException;
use Swoft\Http\Server\Middleware\MiddlewareRegister;
use Swoft\Http\Server\Router\Router;
use Swoft\Http\Server\Router\RouteRegister;
use Swoft\SwoftEvent;

/**
 * Class AppInitCompleteListener
 * @since 2.0
 *
 * @Listener(SwoftEvent::APP_INIT_COMPLETE)
 */
class AppInitCompleteListener implements EventHandlerInterface
{
    /**
     * @param EventInterface $event
     *
     * @throws ContainerException
     * @throws ReflectionException
     * @throws HttpServerException
     */
    public function handle(EventInterface $event): void
    {
        /** @var Router $router Register HTTP routes */
        $router = bean('httpRouter');

        RouteRegister::registerRoutes($router);

        // Register middleware
        MiddlewareRegister::register();
    }
}
```

这里使用了`Swoft\Event\Annotation\Mapping\Listener`注解，对应的事件为`SwoftEvent::APP_INIT_COMPLETE`。

按照上面的分析，这里会调用到`AppInitCompleteListener`的`handle`方法，获取`httpRouter`的`Bean`实例，注册`http服务`的路由信息和中间件。

到这里，我们大概清楚了`EventProcessor`这个模块的作用，注册了所有事件的回调。