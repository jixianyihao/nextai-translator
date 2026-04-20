/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Moonshot } from './moonshot'
import { getSettings, fetchSSE } from '../utils'
import { IMessageRequest } from './interfaces'
import { CUSTOM_MODEL_ID } from '../constants'

vi.mock('../utils', () => {
    return {
        getSettings: vi.fn(),
        fetchSSE: vi.fn(),
    }
})

function createMessageRequest() {
    const onMessage = vi.fn().mockResolvedValue(undefined)
    const onError = vi.fn()
    const onFinished = vi.fn()
    const req: IMessageRequest = {
        rolePrompt: 'You are a translator',
        commandPrompt: 'Translate hello to Chinese',
        onMessage,
        onError,
        onFinished,
        signal: new AbortController().signal,
    }
    return { req, onMessage, onError, onFinished }
}

describe('Moonshot (Anthropic-compatible provider)', () => {
    let engine: Moonshot

    beforeEach(() => {
        vi.clearAllMocks()
        engine = new Moonshot()
    })

    describe('supportCustomModel', () => {
        it('returns true', () => {
            expect(engine.supportCustomModel()).toBe(true)
        })
    })

    describe('getAPIURL', () => {
        it('returns URL from settings', async () => {
            vi.mocked(getSettings).mockResolvedValue({
                moonshotAPIURL: 'https://open.bigmodel.cn/api/anthropic',
            } as any)
            expect(await engine.getAPIURL()).toBe('https://open.bigmodel.cn/api/anthropic')
        })

        it('returns default URL when empty', async () => {
            vi.mocked(getSettings).mockResolvedValue({ moonshotAPIURL: '' } as any)
            expect(await engine.getAPIURL()).toBe('https://open.bigmodel.cn/api/anthropic')
        })

        it('returns default URL when undefined', async () => {
            vi.mocked(getSettings).mockResolvedValue({} as any)
            expect(await engine.getAPIURL()).toBe('https://open.bigmodel.cn/api/anthropic')
        })

        it('supports custom URL for any Anthropic-compatible provider', async () => {
            vi.mocked(getSettings).mockResolvedValue({ moonshotAPIURL: 'https://my-proxy.example.com' } as any)
            expect(await engine.getAPIURL()).toBe('https://my-proxy.example.com')
        })
    })

    describe('getAPIURLPath', () => {
        it('returns path from settings', async () => {
            vi.mocked(getSettings).mockResolvedValue({ moonshotAPIURLPath: '/v1/messages' } as any)
            expect(await engine.getAPIURLPath()).toBe('/v1/messages')
        })

        it('returns default /v1/messages when empty', async () => {
            vi.mocked(getSettings).mockResolvedValue({ moonshotAPIURLPath: '' } as any)
            expect(await engine.getAPIURLPath()).toBe('/v1/messages')
        })

        it('supports custom path', async () => {
            vi.mocked(getSettings).mockResolvedValue({ moonshotAPIURLPath: '/coding/v1/messages' } as any)
            expect(await engine.getAPIURLPath()).toBe('/coding/v1/messages')
        })
    })

    describe('getAPIKey', () => {
        it('returns the API key from settings', async () => {
            vi.mocked(getSettings).mockResolvedValue({ moonshotAPIKey: 'sk-test-key' } as any)
            expect(await engine.getAPIKey()).toBe('sk-test-key')
        })
    })

    describe('getModel', () => {
        it('returns the model from settings', async () => {
            vi.mocked(getSettings).mockResolvedValue({ moonshotAPIModel: 'kimi-latest' } as any)
            expect(await engine.getModel()).toBe('kimi-latest')
        })

        it('returns custom model name when model is CUSTOM_MODEL_ID', async () => {
            vi.mocked(getSettings).mockResolvedValue({
                moonshotAPIModel: CUSTOM_MODEL_ID,
                moonshotCustomModelName: 'my-custom-model',
            } as any)
            expect(await engine.getModel()).toBe('my-custom-model')
        })
    })

    describe('listModels', () => {
        it('returns hardcoded model list', async () => {
            const models = await engine.listModels(undefined)
            expect(models.length).toBeGreaterThan(0)
            expect(models.some((m) => m.id === 'kimi-latest')).toBe(true)
            expect(models.some((m) => m.id === 'k2')).toBe(true)
        })
    })

    describe('sendMessage (Anthropic format)', () => {
        it('sends request in Anthropic format with configurable URL and path', async () => {
            vi.mocked(getSettings).mockResolvedValue({
                moonshotAPIKey: 'sk-kimi-test',
                moonshotAPIURL: 'https://api.kimi.com/coding',
                moonshotAPIURLPath: '/v1/messages',
                moonshotAPIModel: 'kimi-latest',
            } as any)

            const { req, onMessage, onFinished } = createMessageRequest()

            vi.mocked(fetchSSE).mockImplementationOnce(async (url: string, options: any) => {
                // Verify URL constructed from base + path
                expect(url).toBe('https://api.kimi.com/coding/v1/messages')

                const headers = options.headers
                expect(headers['anthropic-version']).toBe('2023-06-01')
                expect(headers['x-api-key']).toBe('sk-kimi-test')

                const body = JSON.parse(options.body)
                expect(body.model).toBe('kimi-latest')
                expect(body.stream).toBe(true)
                expect(body.messages).toEqual([
                    {
                        role: 'user',
                        content: 'You are a translator\n\nTranslate hello to Chinese',
                    },
                ])

                // Simulate Anthropic SSE response
                await options.onMessage(
                    JSON.stringify({
                        type: 'content_block_delta',
                        delta: { type: 'text_delta', text: '你好' },
                    })
                )
                await options.onMessage(JSON.stringify({ type: 'message_stop' }))
            })

            await engine.sendMessage(req)

            expect(onMessage).toHaveBeenCalledWith({ content: '你好', role: '' })
            expect(onFinished).toHaveBeenCalledWith('stop')
        })

        it('uses modelOverride when provided', async () => {
            vi.mocked(getSettings).mockResolvedValue({
                moonshotAPIKey: 'sk-test',
                moonshotAPIURL: 'https://api.kimi.com',
                moonshotAPIURLPath: '/v1/messages',
                moonshotAPIModel: 'kimi-latest',
            } as any)

            const { req } = createMessageRequest()
            req.modelOverride = 'k2'

            vi.mocked(fetchSSE).mockImplementationOnce(async (_url: string, options: any) => {
                const body = JSON.parse(options.body)
                expect(body.model).toBe('k2')
                await options.onMessage(JSON.stringify({ type: 'message_stop' }))
            })

            await engine.sendMessage(req)
            expect(fetchSSE).toHaveBeenCalled()
        })

        it('strips trailing slashes from API URL', async () => {
            vi.mocked(getSettings).mockResolvedValue({
                moonshotAPIKey: 'sk-test',
                moonshotAPIURL: 'https://api.kimi.com/coding/',
                moonshotAPIURLPath: '/v1/messages',
                moonshotAPIModel: 'kimi-latest',
            } as any)

            const { req } = createMessageRequest()

            vi.mocked(fetchSSE).mockImplementationOnce(async (url: string, _options: any) => {
                expect(url).toBe('https://api.kimi.com/coding/v1/messages')
                await _options.onMessage(JSON.stringify({ type: 'message_stop' }))
            })

            await engine.sendMessage(req)
        })

        it('sends only commandPrompt when no rolePrompt', async () => {
            vi.mocked(getSettings).mockResolvedValue({
                moonshotAPIKey: 'sk-test',
                moonshotAPIURL: 'https://api.kimi.com',
                moonshotAPIURLPath: '/v1/messages',
                moonshotAPIModel: 'kimi-latest',
            } as any)

            const { req } = createMessageRequest()
            req.rolePrompt = ''

            vi.mocked(fetchSSE).mockImplementationOnce(async (_url: string, options: any) => {
                const body = JSON.parse(options.body)
                expect(body.messages[0].content).toBe('Translate hello to Chinese')
                await options.onMessage(JSON.stringify({ type: 'message_stop' }))
            })

            await engine.sendMessage(req)
        })

        it('handles error response from API', async () => {
            vi.mocked(getSettings).mockResolvedValue({
                moonshotAPIKey: 'sk-test',
                moonshotAPIURL: 'https://api.kimi.com',
                moonshotAPIURLPath: '/v1/messages',
                moonshotAPIModel: 'kimi-latest',
            } as any)

            const { req, onError } = createMessageRequest()

            vi.mocked(fetchSSE).mockImplementationOnce(async (_url: string, options: any) => {
                await options.onMessage(
                    JSON.stringify({
                        type: 'error',
                        error: { message: 'Invalid API key' },
                    })
                )
            })

            await engine.sendMessage(req)
            expect(onError).toHaveBeenCalledWith('API response: Invalid API key')
        })

        it('handles SSE parse error gracefully', async () => {
            vi.mocked(getSettings).mockResolvedValue({
                moonshotAPIKey: 'sk-test',
                moonshotAPIURL: 'https://api.kimi.com',
                moonshotAPIURLPath: '/v1/messages',
                moonshotAPIModel: 'kimi-latest',
            } as any)

            const { req, onError } = createMessageRequest()

            vi.mocked(fetchSSE).mockImplementationOnce(async (_url: string, options: any) => {
                await options.onMessage('not valid json {{{')
            })

            await engine.sendMessage(req)
            expect(onError).toHaveBeenCalled()
        })

        it('calls onFinished when stream ends without message_stop', async () => {
            vi.mocked(getSettings).mockResolvedValue({
                moonshotAPIKey: 'sk-test',
                moonshotAPIURL: 'https://api.kimi.com',
                moonshotAPIURLPath: '/v1/messages',
                moonshotAPIModel: 'kimi-latest',
            } as any)

            const { req, onFinished } = createMessageRequest()

            // fetchSSE resolves without any onMessage calls
            vi.mocked(fetchSSE).mockImplementationOnce(async () => {})

            await engine.sendMessage(req)
            expect(onFinished).toHaveBeenCalledWith('stop')
        })
    })
})
