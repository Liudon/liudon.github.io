export async function onRequest(context) {
    try {
        return context.env.analytics.fetch(context.request);
    } catch(e) {
        return new Response(`${e.message}\n${e.stack}`, { status: 500 }); 
    }
}