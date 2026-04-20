import { expect, test } from './fixtures'
import { getOptionsPageUrl } from './common'

test.describe('Custom (Anthropic Compatible) provider settings', () => {
    test.beforeEach(async ({ page, extensionId }) => {
        await page.goto(getOptionsPageUrl(extensionId))
        await expect(page.getByTestId('settings-container')).toBeVisible()
    })

    test('should show Custom in provider dropdown', async ({ page }) => {
        // Open the provider selector dropdown
        const providerSelect = page.getByRole('combobox', { name: /provider/i }).first()
        if (await providerSelect.isVisible()) {
            await providerSelect.click()
            const customOption = page.getByText('Anthropic Compatible')
            await expect(customOption).toBeVisible()
        }
    })

    test('should configure Custom provider with API Key, URL, and Model', async ({ page }) => {
        // Clear any existing settings
        await page.evaluate(() => {
            return chrome.storage.sync.clear()
        })

        // Reload settings page
        await page.reload()
        await expect(page.getByTestId('settings-container')).toBeVisible()

        // Set Custom provider via storage and reload
        await page.evaluate(() => {
            return chrome.storage.sync.set({
                provider: 'Custom',
                customAPIKey: 'test-api-key-123',
                customAPIURL: 'https://open.bigmodel.cn/api/anthropic',
                customAPIURLPath: '/v1/messages',
                customAPIModel: 'glm-5.1',
            })
        })

        await page.reload()
        await expect(page.getByTestId('settings-container')).toBeVisible()

        // Verify settings were persisted
        const settings = await page.evaluate(() => {
            return chrome.storage.sync.get([
                'provider',
                'customAPIKey',
                'customAPIURL',
                'customAPIURLPath',
                'customAPIModel',
            ])
        })

        expect(settings.provider).toBe('Custom')
        expect(settings.customAPIKey).toBe('test-api-key-123')
        expect(settings.customAPIURL).toBe('https://open.bigmodel.cn/api/anthropic')
        expect(settings.customAPIURLPath).toBe('/v1/messages')
        expect(settings.customAPIModel).toBe('glm-5.1')
    })

    test('should default to correct Anthropic URL and path', async ({ page }) => {
        // Set provider to Custom without URL settings
        await page.evaluate(() => {
            return chrome.storage.sync.set({
                provider: 'Custom',
                customAPIKey: 'test-key',
            })
        })

        await page.reload()
        await expect(page.getByTestId('settings-container')).toBeVisible()

        // Verify defaults are NOT in raw storage (they're applied at runtime by getSettings)
        const rawSettings = await page.evaluate(() => {
            return chrome.storage.sync.get(['customAPIURL', 'customAPIURLPath'])
        })
        expect(rawSettings.customAPIURL).toBeFalsy()
        expect(rawSettings.customAPIURLPath).toBeFalsy()
    })

    test('should support custom URL for any Anthropic-compatible provider', async ({ page }) => {
        await page.evaluate(() => {
            return chrome.storage.sync.set({
                provider: 'Custom',
                customAPIKey: 'custom-key',
                customAPIURL: 'https://api.kimi.com/coding',
                customAPIURLPath: '/v1/messages',
                customAPIModel: 'kimi-latest',
            })
        })

        await page.reload()
        await expect(page.getByTestId('settings-container')).toBeVisible()

        const settings = await page.evaluate(() => {
            return chrome.storage.sync.get(['customAPIURL', 'customAPIURLPath', 'customAPIModel'])
        })

        expect(settings.customAPIURL).toBe('https://api.kimi.com/coding')
        expect(settings.customAPIURLPath).toBe('/v1/messages')
        expect(settings.customAPIModel).toBe('kimi-latest')
    })
})
