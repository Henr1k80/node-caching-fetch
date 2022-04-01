# node-caching-fetch
A cache for node-fetch that caches according to response cache headers, incl. stale-while-revalidate &amp; stale-while-error with background revalidation

I was a bit surprised to find that node fetch does not cache responses if cache headers are set.
There are no plans to support it either https://github.com/node-fetch/node-fetch/issues/68

So I made a wrapper around node fetch that does the caching according to HTTP cache headers
https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Cache-Control

It revalidates the cache in the background if stale-while-revalidate is set, allowing the cached response to be returned immediately.

Cached responses are purged according to cache headers set to not fill the memory with expired cache.

Age is set on cached responses to control freshness if response headers are passed on to a CDN.

Designed to be a 1:1 replacement of node-fetch, exept for the include.

The philosofy behing this module is that the origin should have correct headers and control cache times.
If caching is configured in multiple layers, freshness is hard to control and you will have a hard time understanding where to change a configuration.

If there aren't any cache headers set in the origin, this module will not help you, it will only be an extra middle layer that does nothing.

An example of usage can be found in example.mjs
