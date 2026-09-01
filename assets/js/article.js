"use strict";


// ============================================================
// Hugo build-time configuration
// ============================================================

const TWIKOO_VERSION =
    {{ .Params.twikoo.version | jsonify }};

const TWIKOO_ENV_ID =
    {{ (.Params.twikoo.envId | default "https://comment.liudon.com") | jsonify }};

const TWIKOO_URL =
    `https://cdnjs.cloudflare.com/ajax/libs/twikoo/${TWIKOO_VERSION}/twikoo.min.js`;


// ============================================================
// ViewImage
// ============================================================

function initViewImage() {

    if (!window.ViewImage) {
        return;
    }

    const images =
        document.querySelectorAll(
            ".post-content img"
        );

    if (images.length === 0) {
        return;
    }

    window.ViewImage.init(
        ".post-content img"
    );
}


// ============================================================
// Twikoo state
// ============================================================

let twikooLoading = null;

let twikooInitialized = false;


// ============================================================
// Twikoo initialization
// ============================================================

function initTwikoo() {

    if (twikooInitialized) {
        return;
    }

    if (!window.twikoo) {
        return;
    }

    const container =
        document.querySelector(
            "#tcomment"
        );

    if (!container) {
        return;
    }

    twikooInitialized = true;

    try {

        const result =
            window.twikoo.init({
                envId:
                    TWIKOO_ENV_ID,

                el:
                    "#tcomment",
            });

        if (
            result &&
            typeof result.catch ===
                "function"
        ) {

            result.catch(error => {

                twikooInitialized = false;

                console.error(
                    "Twikoo initialization failed:",
                    error
                );
            });
        }

    } catch (error) {

        twikooInitialized = false;

        console.error(
            "Twikoo initialization failed:",
            error
        );
    }
}


// ============================================================
// Dynamically load Twikoo
// ============================================================

function loadTwikoo() {

    if (window.twikoo) {

        initTwikoo();

        return Promise.resolve();
    }


    if (twikooLoading) {

        return twikooLoading;
    }


    twikooLoading =
        new Promise(
            (resolve, reject) => {

                const script =
                    document.createElement(
                        "script"
                    );

                script.src =
                    TWIKOO_URL;

                script.async =
                    true;

                script.crossOrigin =
                    "anonymous";


                script.onload =
                    () => {

                        initTwikoo();

                        resolve();
                    };


                script.onerror =
                    () => {

                        twikooLoading =
                            null;

                        reject(
                            new Error(
                                `Failed to load Twikoo: ${TWIKOO_URL}`
                            )
                        );
                    };


                document.head.appendChild(
                    script
                );
            }
        );


    return twikooLoading;
}


// ============================================================
// Lazy load Twikoo
// ============================================================

function initLazyTwikoo() {

    const container =
        document.querySelector(
            "#tcomment"
        );


    // 当前文章没有评论区域：
    // 完全不下载 Twikoo。

    if (!container) {
        return;
    }


    // 老浏览器 fallback

    if (
        !(
            "IntersectionObserver"
            in window
        )
    ) {

        loadTwikoo()
            .catch(console.error);

        return;
    }


    const observer =
        new IntersectionObserver(
            entries => {

                const shouldLoad =
                    entries.some(
                        entry =>
                            entry.isIntersecting
                    );


                if (!shouldLoad) {
                    return;
                }


                observer.disconnect();


                loadTwikoo()
                    .catch(error => {

                        console.error(
                            error
                        );
                    });
            },
            {
                // 用户距离评论区约 1000px
                // 时开始下载 Twikoo，
                // 避免滚动到评论区才等待。

                rootMargin:
                    "1000px 0px",
            }
        );


    observer.observe(
        container
    );
}


// ============================================================
// Article initialization
// ============================================================

function initArticle() {

    initViewImage();

    initLazyTwikoo();
}


// ============================================================
// DOM ready
// ============================================================

if (
    document.readyState ===
    "loading"
) {

    document.addEventListener(
        "DOMContentLoaded",
        initArticle,
        {
            once: true,
        }
    );

} else {

    initArticle();
}
