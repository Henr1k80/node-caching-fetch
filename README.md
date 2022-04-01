# node-caching-fetch
A cache for node-fetch that caches according to response cache headers, incl. stale-while-revalidate &amp; stale-while-error with background revalidation

I was a bit surprised to find that node fetch does not cache responses if cache headers are set.
There are no plans to support it either https://github.com/node-fetch/node-fetch/issues/68

So I made a wrapper around node fetch that does the caching according to HTTP cache headers
https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Cache-Control

It revalidates the cache in the background if stale-while-revalidate is set, allowing the cached response to be returned immediately.

Cached responses are purged according to cache headers set to not fill the memory with expired cache.

Designed to be a 1:1 replacement of node-fetch, exept for the include.

An example of usage can be found in example.mjs
