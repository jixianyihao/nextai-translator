/**
 * Real integration test for Moonshot (Kimi) Anthropic-compatible API.
 *
 * Run:
 *   MOONSHOT_API_KEY=sk-your-key npx vitest run src/common/engines/moonshot.integration.test.ts
 *
 * Or test a different provider:
 *   MOONSHOT_API_KEY=sk-xxx MOONSHOT_API_URL=https://my-proxy.com MOONSHOT_API_URL_PATH=/v1/messages npx vitest run src/common/engines/moonshot.integration.test.ts
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from 'vitest'

const apiKey = process.env.MOONSHOT_API_KEY
const apiURL = process.env.MOONSHOT_API_URL || 'https://api.kimi.com'
const apiURLPath = process.env.MOONSHOT_API_URL_PATH || '/v1/messages'
const model = process.env.MOONSHOT_API_MODEL || 'kimi-latest'

const skip = !apiKey

async function callAnthropicAPI(url: string, key: string, modelName: string, content: string): Promise<string> {
    const resp = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'anthropic-version': '2023-06-01',
            'anthropic-dangerous-direct-browser-access': 'true',
            'x-api-key': key,
        },
        body: JSON.stringify({
            model: modelName,
            stream: true,
            messages: [{ role: 'user', content }],
            temperature: 0,
            // eslint-disable-next-line camelcase
            max_tokens: 256,
        }),
    })

    if (!resp.ok) {
        const text = await resp.text()
        throw new Error(`HTTP ${resp.status}: ${text}`)
    }

    const reader = resp.body!.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let result = ''

    for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''
        for (const line of lines) {
            const trimmed = line.trim()
            if (!trimmed.startsWith('data: ')) continue
            const data = trimmed.slice(6)
            if (data === '[DONE]') continue
            try {
                const parsed = JSON.parse(data)
                if (parsed.type === 'content_block_delta' && parsed.delta?.type === 'text_delta') {
                    result += parsed.delta.text
                }
            } catch {
                // skip non-JSON lines
            }
        }
    }

    return result
}

describe.skipIf(skip)('Moonshot real API', () => {
    const fullURL = `${apiURL.replace(/\/+$/, '')}${apiURLPath}`

    it('translates "hello" to Chinese', async () => {
        console.log(`\n  → POST ${fullURL} model=${model}`)
        const result = await callAnthropicAPI(
            fullURL,
            apiKey!,
            model,
            'Translate "hello" to Chinese. Reply with only the translation.'
        )
        console.log(`  ← ${result}`)
        expect(result).toContain('你好')
    }, 30000)

    it('responds to a simple prompt', async () => {
        console.log(`\n  → POST ${fullURL} model=${model}`)
        const result = await callAnthropicAPI(fullURL, apiKey!, model, 'Say "test ok" and nothing else.')
        console.log(`  ← ${result}`)
        expect(result.length).toBeGreaterThan(0)
    }, 30000)

    it('handles role + command prompt', async () => {
        console.log(`\n  → POST ${fullURL} model=${model}`)
        const result = await callAnthropicAPI(
            fullURL,
            apiKey!,
            model,
            'You are a translator.\n\nTranslate "good morning" to Japanese. Reply with only the translation.'
        )
        console.log(`  ← ${result}`)
        expect(result.length).toBeGreaterThan(0)
    }, 30000)
})
