# node-caching-fetch
A cache for node-fetch that caches according to response cache headers, incl. stale-while-revalidate &amp; stale-while-error with background revalidation

I was a bit surprised to find that node fetch does not cache responses if cache headers are set.
There are no plans to support it either https://github.com/node-fetch/node-fetch/issues/68

So, I made a wrapper around node fetch that does the caching according to HTTP cache headers
https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Cache-Control
HTTP/1.0 cache headers are ignored.

It revalidates the cache in the background if stale-while-revalidate is set, allowing the cached response to be returned immediately.

Cached responses are purged according to cache headers set, thereby avoiding filling the memory with expired cache.

Age is set on cached responses to help control freshness, e.g., if response headers are passed on to a CDN.

Designed to be a 1:1 replacement of node-fetch, except for the include.

If there aren't any cache headers set in the origin, this module will not help you, it will only be an extra middle layer that does nothing.

An example of usage can be found in example.mjs

The philosophy behind this module is, that the origin should have correct headers and control cache times, one place to rule them all, cache-wise.
If caching is configured and controlled in multiple layers (backend, SSR, CDN etc.), freshness is hard to control, and you will have a hard time understanding where to change a configuration and have a hard time controlling the freshness.
HTTP headers are CDN agnostic, so you do not need to learn and setup a new CDN, if you change provider.
You avoid documenting what caching you configured in SSR or CDN & how and why you did so, leave that to the origin.
Bad news is that you need someone with HTTP cache header knowledge to create the endpoints you use. A common error here is to create a POST endpoint because it is "prettier" to post a complex request model, than to have a large query string. Or have arguments in custom headers. Problem is that most CDNs do not support caching or varying by these parameters https://developer.mozilla.org/en-US/docs/Web/HTTP/Caching#targets_of_caching_operations.
You need to design the endpoint to be cacheable, if performance is a feature. I have seen many ignore this, until it is too late.
Please require proper methods of caching and control up front to avoid this, parameters can be tweaked later. This will also help serving responses from CDN edge nodes (or web server response cache if configured)

The example is requesting a site running a .NET site I have made for testing this module https://github.com/Henr1k80/CacheHeaderTestingApi
