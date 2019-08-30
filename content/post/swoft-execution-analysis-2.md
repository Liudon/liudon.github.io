---
title: "Swoft 框架运行分析（二） —— AnnotationProcessor模块分析"
date: 2019-08-29T19:11:04+08:00
draft: false
Keywords: Swoft
---

上一篇介绍了，`SwoftApplication`里定义了6个Processor对象。

```
protected function processors(): array
    {
        return [
            new EnvProcessor($this),
            new ConfigProcessor($this),
            new AnnotationProcessor($this),
            new BeanProcessor($this),
            new EventProcessor($this),
            new ConsoleProcessor($this),
        ];
    }
```

所有的Processor实现都在`framework\src\Processor`目录下。

1. EnvProcessor，初始化环境。

2. ConfigProcessor，初始化配置。

3. AnnotationProcessor，初始化注解。

4. BeanProcessor，初始化Bean。

5. EventProcessor，初始化事件。

6. ConsoleProcessor，初始化控制台。

今天先讲一下`AnnotationProcessor`这个模块的实现。

```
<?php declare(strict_types=1);

namespace Swoft\Processor;

use Exception;
use Swoft\Annotation\AnnotationRegister;
use Swoft\Log\Helper\CLog;

/**
 * Annotation processor
 * @since 2.0
 */
class AnnotationProcessor extends Processor
{
    /**
     * Handle annotation
     *
     * @return bool
     * @throws Exception
     */
    public function handle(): bool
    {
        if (!$this->application->beforeAnnotation()) {
            CLog::warning('Stop annotation processor by beforeAnnotation return false');
            return false;
        }

        $app = $this->application;

        // Find AutoLoader classes. Parse and collect annotations.
        AnnotationRegister::load([
            'inPhar'               => \IN_PHAR,
            'basePath'             => $app->getBasePath(),
            'notifyHandler'        => [$this, 'notifyHandler'],
            'disabledAutoLoaders'  => $app->getDisabledAutoLoaders(),
            'disabledPsr4Prefixes' => $app->getDisabledPsr4Prefixes(),
        ]);

        $stats = AnnotationRegister::getClassStats();

        CLog::info(
            'Annotations is scanned(autoloader %d, annotation %d, parser %d)',
            $stats['autoloader'],
            $stats['annotation'],
            $stats['parser']
        );

        return $this->application->afterAnnotation();
    }

    /**
     * @param string $type
     * @param string $target
     * @see \Swoft\Annotation\Resource\AnnotationResource::load()
     */
    public function notifyHandler(string $type, $target): void
    {
        switch ($type) {
            case 'excludeNs':
                CLog::debug('Exclude namespace %s', $target);
                break;
            case 'noLoaderFile':
                CLog::debug('No autoloader on %s', $target);
                break;
            case 'noLoaderClass':
                CLog::debug('Autoloader class not exist %s', $target);
                break;
            case 'findLoaderClass':
                CLog::debug('Find autoloader %s', $target);
                break;
            case 'addLoaderClass':
                CLog::debug('Parse autoloader %s', $target);
                break;
            case 'noExistClass':
                CLog::debug('Skip interface or trait %s', $target);
                break;
        }
    }
}
```

核心逻辑调用`AnnotationRegister`类的`load`方法，定义如下。

```
    /**
     * Load annotation class
     *
     * @param array $config
     *
     * @throws AnnotationException
     * @throws ReflectionException
     */
    public static function load(array $config = []): void
    {
        $resource = new AnnotationResource($config);
        $resource->load();
    }
```

这里又调用了`AnnotationResource`类的`load`方法，定义如下。

```
    /**
     * Load annotation resource by find ClassLoader
     *
     * @throws AnnotationException
     * @throws ReflectionException
     */
    public function load(): void
    {
        $prefixDirsPsr4 = $this->classLoader->getPrefixesPsr4();

        foreach ($prefixDirsPsr4 as $ns => $paths) {
            // Only scan namespaces
            if ($this->onlyNamespaces && !in_array($ns, $this->onlyNamespaces, true)) {
                $this->notify('excludeNs', $ns);
                continue;
            }

            // It is excluded psr4 prefix
            if ($this->isExcludedPsr4Prefix($ns)) {
                AnnotationRegister::registerExcludeNs($ns);
                $this->notify('excludeNs', $ns);
                continue;
            }

            // Find package/component loader class
            foreach ($paths as $path) {
                $loaderFile = $this->getAnnotationClassLoaderFile($path);
                if (!file_exists($loaderFile)) {
                    $this->notify('noLoaderFile', $this->clearBasePath($path), $loaderFile);
                    continue;
                }

                $loaderClass = $this->getAnnotationLoaderClassName($ns);
                if (!class_exists($loaderClass)) {
                    $this->notify('noLoaderClass', $loaderClass);
                    continue;
                }

                $loaderObject = new $loaderClass();
                if (!$loaderObject instanceof LoaderInterface) {
                    $this->notify('invalidLoader', $loaderFile);
                    continue;
                }

                $this->notify('findLoaderClass', $this->clearBasePath($loaderFile));

                // If is disable, will skip scan annotation classes
                if (!isset($this->disabledAutoLoaders[$loaderClass])) {
                    AnnotationRegister::registerAutoLoaderFile($loaderFile);
                    $this->notify('addLoaderClass', $loaderClass);
                    $this->loadAnnotation($loaderObject);
                }

                // Storage auto loader to register
                AnnotationRegister::addAutoLoader($ns, $loaderObject);
            }
        }
    }
```

通过`getPrefixesPsr4`方法获取所有自动加载的命名空间和目录，遍历目录下的`AutoLoader.php`文件。

通过`registerAutoLoaderFile`注册自动加载文件到`AnnotationRegister`对象上。

然后调用了`loadAnnotation`方法，传入的是一个`autoload`对象。

```
    /**
     * Load annotations from an component loader config.
     *
     * @param LoaderInterface $loader
     *
     * @throws AnnotationException
     * @throws ReflectionException
     */
    private function loadAnnotation(LoaderInterface $loader): void
    {
        $nsPaths = $loader->getPrefixDirs();

        foreach ($nsPaths as $ns => $path) {
            $iterator = DirectoryHelper::recursiveIterator($path);

            /* @var SplFileInfo $splFileInfo */
            foreach ($iterator as $splFileInfo) {
                $filePath = $splFileInfo->getPathname();
                // $splFileInfo->isDir();
                if (is_dir($filePath)) {
                    continue;
                }

                $fileName  = $splFileInfo->getFilename();
                $extension = $splFileInfo->getExtension();

                if ($this->loaderClassSuffix !== $extension || strpos($fileName, '.') === 0) {
                    continue;
                }

                // It is exclude filename
                if (isset($this->excludedFilenames[$fileName])) {
                    AnnotationRegister::registerExcludeFilename($fileName);
                    continue;
                }

                $suffix    = sprintf('.%s', $this->loaderClassSuffix);
                $pathName  = str_replace([$path, '/', $suffix], ['', '\\', ''], $filePath);
                $className = sprintf('%s%s', $ns, $pathName);

                // Fix repeat included file bug
                $autoload = in_array($filePath, $this->includedFiles, true);

                // Will filtering: interfaces and traits
                if (!class_exists($className, !$autoload)) {
                    $this->notify('noExistClass', $className);
                    continue;
                }

                // Parse annotation
                $this->parseAnnotation($ns, $className);
            }
        }
    }
```

通过getPrefixDirs获取当前命名空间的目录，然后通过`recursiveIterator`遍历目录下的文件。

排除目录和非`.php`结尾的文件，最后会调用`parseAnnotation`方法。

```
    /**
     * Parser annotation
     *
     * @param string $namespace
     * @param string $className
     *
     * @throws AnnotationException
     * @throws ReflectionException
     */
    private function parseAnnotation(string $namespace, string $className): void
    {
        // Annotation reader
        $reflectionClass = new ReflectionClass($className);

        // Fix ignore abstract
        if ($reflectionClass->isAbstract()) {
            return;
        }
        $oneClassAnnotation = $this->parseOneClassAnnotation($reflectionClass);

        if (!empty($oneClassAnnotation)) {
            AnnotationRegister::registerAnnotation($namespace, $className, $oneClassAnnotation);
        }
    }
```

这里调用了`parseOneClassAnnotation`方法。

```
    /**
     * Parse an class annotation
     *
     * @param ReflectionClass $reflectionClass
     *
     * @return array
     * @throws AnnotationException
     * @throws ReflectionException
     */
    private function parseOneClassAnnotation(ReflectionClass $reflectionClass): array
    {
        // Annotation reader
        $reader    = new AnnotationReader();
        $className = $reflectionClass->getName();

        $oneClassAnnotation = [];
        $classAnnotations   = $reader->getClassAnnotations($reflectionClass);

        // Register annotation parser
        foreach ($classAnnotations as $classAnnotation) {
            if ($classAnnotation instanceof AnnotationParser) {
                $this->registerParser($className, $classAnnotation);

                return [];
            }
        }

        // Class annotation
        if (!empty($classAnnotations)) {
            $oneClassAnnotation['annotation'] = $classAnnotations;
            $oneClassAnnotation['reflection'] = $reflectionClass;
        }

        // Property annotation
        $reflectionProperties = $reflectionClass->getProperties();
        foreach ($reflectionProperties as $reflectionProperty) {
            $propertyName        = $reflectionProperty->getName();
            $propertyAnnotations = $reader->getPropertyAnnotations($reflectionProperty);

            if (!empty($propertyAnnotations)) {
                $oneClassAnnotation['properties'][$propertyName]['annotation'] = $propertyAnnotations;
                $oneClassAnnotation['properties'][$propertyName]['reflection'] = $reflectionProperty;
            }
        }

        // Method annotation
        $reflectionMethods = $reflectionClass->getMethods();
        foreach ($reflectionMethods as $reflectionMethod) {
            $methodName        = $reflectionMethod->getName();
            $methodAnnotations = $reader->getMethodAnnotations($reflectionMethod);

            if (!empty($methodAnnotations)) {
                $oneClassAnnotation['methods'][$methodName]['annotation'] = $methodAnnotations;
                $oneClassAnnotation['methods'][$methodName]['reflection'] = $reflectionMethod;
            }
        }

        $parentReflectionClass = $reflectionClass->getParentClass();
        if ($parentReflectionClass !== false) {
            $parentClassAnnotation = $this->parseOneClassAnnotation($parentReflectionClass);
            if (!empty($parentClassAnnotation)) {
                $oneClassAnnotation['parent'] = $parentClassAnnotation;
            }
        }

        return $oneClassAnnotation;
    }
```

这里就是解析注解了，可以看到分别有类注解、属性注解和方法注解三类。

这里注意这一段代码。

```
        // Register annotation parser
        foreach ($classAnnotations as $classAnnotation) {
            if ($classAnnotation instanceof AnnotationParser) {
                $this->registerParser($className, $classAnnotation);

                return [];
            }
        }
```

遍历注解类，如果注解属于`AnnotationParser`实例，这里调用`registerParser`进行注册。

```
    /**
     * @param string $annotationClass
     * @param string $parserClassName
     */
    public static function registerParser(string $annotationClass, string $parserClassName): void
    {
        self::$classStats['parser']++;
        self::$parsers[$annotationClass] = $parserClassName;
    }
```


回到上一个方法，解析完后，又调用了`AnnotationRegister`类的`registerAnnotation`方法进行注册。

```
    /**
     * @param string $loadNamespace
     * @param string $className
     * @param array  $classAnnotation
     */
    public static function registerAnnotation(string $loadNamespace, string $className, array $classAnnotation): void
    {
        self::$classStats['annotation']++;
        self::$annotations[$loadNamespace][$className] = $classAnnotation;
    }
```

至此，整个`AnnotationProcessor`加载完毕，这里`AnnotationRegister`类里会有两个属性`annotations`和`parsers`，这个信息在后面的`BeanProcessor`里还会用到。