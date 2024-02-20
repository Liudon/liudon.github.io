export async function onRequestGet(context) {
    return context.env.analytics.fetch(context.request);
}