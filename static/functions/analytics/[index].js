export async function onRequest(context) {
    try {
        return await postHandler(context);
    } catch(e) {
        return new Response(`${e.message}\n${e.stack}`, { status: 500 }); 
    }
}

async function postHandler(context) {
    const GA_DOMAIN = 'google-analytics.com';
    const GA_COLLECT_PATH = 'g\/collect';
    const COLLECT_PATH = 'analytics/post';
    const DOMAIN = context.request.headers.get('host');

    const cf_ip = context.request.headers.get('CF-Connecting-IP');
    const cf_country = context.request.cf.country;
    const ga_url = url.replace(`${DOMAIN}/${COLLECT_PATH}`, `${GA_DOMAIN}/${GA_COLLECT_PATH}`) + `&up.IP=${cf_ip}&up.IPCountry=${cf_country}`
    const newReq = await readRequest(context.request, ga_url);
    context.waitUntil(fetch(newReq));

    return new Response(null, {
        status: 204,
        statusText: 'No Content',
      });
}

async function readRequest(request, url) {
    const { _, headers } = request;
    const nq = {
      method: request.method,
      headers: {
        Origin: headers.get('origin'),
        'Cache-Control': 'max-age=0',
        'User-Agent': headers.get('user-agent'),
        Accept: headers.get('accept'),
        'Accept-Language': headers.get('accept-language'),
        'Content-Type': headers.get('content-type') || 'text/plain',
        Referer: headers.get('referer'),
      },
      body: request.body,
    };
    return new Request(url, nq);
  }