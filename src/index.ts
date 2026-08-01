/**
 * Welcome to Cloudflare Workers! This is your first worker.
 *
 * - Run `npm run dev` in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your worker in action
 * - Run `npm run deploy` to publish your worker
 *
 * Bind resources to your worker in `wrangler.jsonc`. After adding bindings, a type definition for the
 * `Env` object can be regenerated with `npm run cf-typegen`.
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */
// 1. 导入类型

/// <reference types="@cloudflare/workers-types" />
import { R2Bucket, type ExportedHandler } from '@cloudflare/workers-types'

const imagesApiUrl = 'https://api.astrvis.top'
const imgCacheTime = 2592000

export interface Env {
	R2_BUCKET: R2Bucket
}
type ImageDataResponse = {
	success: boolean
	list: {
		path: string
		thumbnailPath: string
		type: string
	}
}
type ImagePathResponse = {
	imagePath: string
	type: string
}

export default {
	async fetch(request, env, ctx) {
		try {
			const url = new URL(request.url)
			const cache = caches.default
			const parts = url.pathname.split('/').filter(Boolean)
			const hash = parts[0]
			const cacheURL = `${url.origin}/${hash}`

			// 跨域 OPTIONS 预检
			if (request.method === 'OPTIONS') {
				return new Response(null, {
					headers: {
						'Access-Control-Allow-Origin': '*',
						'Access-Control-Allow-Methods': 'GET,OPTIONS',
						'Access-Control-Allow-Headers': '*'
					}
				})
			}

			if (!hash || hash.length !== 64) {
				return newResponse('404 Not Found', 404, 600)
			}
			const cacheKey = new Request(cacheURL, request)
			const cacheResponse = await cache.match(cacheKey)

			// ✅ 修复：缓存命中判断
			if (cacheResponse) {
				console.info('图片缓存命中')
				return cacheResponse
			}

			let path: string
			let type: string
			const imagePathKey = new Request(`${url.origin}/data/${hash}`)
			const cacheImageExt = await cache.match(imagePathKey)

			if (cacheImageExt) {
				const clone = cacheImageExt.clone()
				const res: ImagePathResponse = await clone.json()
				path = res.imagePath
				type = res.type
				console.info('元数据缓存命中')
			} else {
				const apiUrl = `${imagesApiUrl}/api/images/` + hash
				const fetchRes = await fetchWithRetry(apiUrl)

				if (fetchRes.status === 500) {
					return newResponse('上游服务器错误', 500)
				}
				if (fetchRes.status === 404) {
					return newResponse('404 Not Found', 404, 600)
				}
				if (fetchRes.status !== 200) {
					return newResponse('400 Bad Request', 400)
				}
				const res: ImageDataResponse = await fetchRes.json()
				const imagePath = findPathByHash(hash, res.list.path, res.list.thumbnailPath)

				if (!imagePath) {
					return newResponse('404 Not Found', 404, 600)
				}
				const imgDataRes = newResponse(JSON.stringify({ imagePath, type: res.list.type }), 200, imgCacheTime)
				await cache.put(imagePathKey, imgDataRes.clone())
				path = imagePath
				type = res.list.type
			}

			const r2ObjectKey = await env.R2_BUCKET.get(path)
			if (!r2ObjectKey) {
				return newResponse('404 Not Found', 404, 600)
			}
			const response = newResponse(r2ObjectKey.body, 200, imgCacheTime, { 'Content-Type': type })
			await cache.put(cacheKey, response.clone())
			return response
		} catch (err) {
			if (err instanceof Error) {
				if (err.name === 'AbortError') {
					console.error('请求超时', err)
					return newResponse('请求超时', 504)
				}
			}
			console.error('服务器错误', err)
			return newResponse('服务器错误', 500)
		}
	}
} satisfies ExportedHandler<Env>

/**
 * 构造响应
 * @param message 响应文本 / ReadableStream
 * @param status HTTP状态码
 * @param maxAge 缓存秒数
 * @param options 可选headers，会覆盖默认header
 */
const newResponse = (message: ReadableStream<any> | string, status: number = 200, maxAge = 60, options?: HeadersInit): Response => {
	const defaultHeaders: Record<string, string> = {
		'Cache-Control': `public, max-age=${maxAge}`,
		'CDN-Cache-Control': `public, max-age=${maxAge}`,
		'Access-Control-Allow-Origin': '*'
	}

	const headers = new Headers(defaultHeaders)
	if (options) {
		const incoming = new Headers(options)
		for (const [k, v] of incoming) {
			headers.set(k, v)
		}
	}

	return new Response(message, {
		status,
		headers
	})
}

/**
 * 精确匹配文件名哈希，消除includes子串误命中风险
 */
const findPathByHash = (targetHash: string, originPath: string, thumbPath: string): string | null => {
	const getPureHash = (fullPath: string) => {
		const filename = fullPath.split('/').pop()
		if (!filename) return ''
		return filename.split('.')[0]
	}
	if (getPureHash(originPath) === targetHash) return originPath
	if (getPureHash(thumbPath) === targetHash) return thumbPath
	return null
}

/**
 * 带超时与重试的fetch
 * @param url 请求地址
 * @param options fetch参数
 * @param timeout 单次请求超时 ms
 * @param maxRetry 最大重试次数
 */
async function fetchWithRetry(url: string, options: RequestInit = {}, timeout = 5000, maxRetry = 2): Promise<Response> {
	let attempt = 0
	while (attempt <= maxRetry) {
		const controller = new AbortController()
		const timer = setTimeout(() => controller.abort(), timeout)
		try {
			const resp = await fetch(url, {
				...options,
				signal: controller.signal
			})
			clearTimeout(timer)
			return resp
		} catch (err: any) {
			clearTimeout(timer)
			attempt++
			if (attempt > maxRetry) {
				throw err
			}
			console.warn(`请求失败，准备第${attempt}次重试`, err.name)
			await new Promise((r) => setTimeout(r, 200))
		}
	}
	throw new Error('无法抵达上游接口')
}
