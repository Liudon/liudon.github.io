export async function onRequest(context) {
    return context.env.analytics.fetch(context.request);
}