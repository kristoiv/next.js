/* eslint-env jest */

import http from 'http'
import url from 'url'
import fs from 'fs-extra'
import cheerio from 'cheerio'
import { join } from 'path'
import webdriver from 'next-webdriver'
import escapeRegex from 'escape-string-regexp'
import {
  fetchViaHTTP,
  findPort,
  killApp,
  launchApp,
  nextBuild,
  nextStart,
  renderViaHTTP,
  File,
  waitFor,
  normalizeRegEx,
  getPageFileFromPagesManifest,
  check,
} from 'next-test-utils'

jest.setTimeout(1000 * 60 * 2)

const appDir = join(__dirname, '../')
const nextConfig = new File(join(appDir, 'next.config.js'))
let app
let appPort
let buildPagesDir
let buildId

const locales = ['en-US', 'nl-NL', 'nl-BE', 'nl', 'fr-BE', 'fr', 'en']

async function addDefaultLocaleCookie(browser) {
  // make sure default locale is used in case browser isn't set to
  // favor en-US by default, (we use all caps to ensure it's case-insensitive)
  await browser.manage().addCookie({ name: 'NEXT_LOCALE', value: 'EN-US' })
  await browser.get(browser.initUrl)
}

function runTests(isDev) {
  it('should have correct values for non-prefixed path', async () => {
    for (const paths of [
      ['/links', '/links'],
      ['/another', '/another'],
      ['/gsp/fallback/first', '/gsp/fallback/[slug]'],
      ['/gsp/no-fallback/first', '/gsp/no-fallback/[slug]'],
    ]) {
      const [asPath, pathname] = paths

      const res = await fetchViaHTTP(appPort, asPath, undefined, {
        redirect: 'manual',
        headers: {
          'accept-language': 'fr',
        },
      })

      expect(res.status).toBe(200)
      const $ = cheerio.load(await res.text())
      expect($('html').attr('lang')).toBe('en-US')
      expect($('#router-locale').text()).toBe('en-US')
      expect($('#router-default-locale').text()).toBe('en-US')
      expect(JSON.parse($('#router-locales').text())).toEqual(locales)
      expect($('#router-pathname').text()).toBe(pathname)
      expect($('#router-as-path').text()).toBe(asPath)
    }
  })

  it('should not have hydration mis-match from hash', async () => {
    const browser = await webdriver(appPort, '/en#')

    expect(await browser.elementByCss('html').getAttribute('lang')).toBe('en')
    expect(await browser.elementByCss('#router-locale').text()).toBe('en')
    expect(await browser.elementByCss('#router-default-locale').text()).toBe(
      'en-US'
    )
    expect(
      JSON.parse(await browser.elementByCss('#router-locales').text())
    ).toEqual(locales)
    expect(await browser.elementByCss('#router-pathname').text()).toBe('/')
    expect(await browser.elementByCss('#router-as-path').text()).toBe('/')
    expect(await browser.eval('window.caughtWarns')).toEqual([])
  })

  if (!isDev) {
    it('should add i18n config to routes-manifest', async () => {
      const routesManifest = await fs.readJSON(
        join(appDir, '.next/routes-manifest.json')
      )

      expect(routesManifest.i18n).toEqual({
        locales: ['en-US', 'nl-NL', 'nl-BE', 'nl', 'fr-BE', 'fr', 'en'],
        defaultLocale: 'en-US',
        domains: [
          {
            http: true,
            domain: 'example.be',
            defaultLocale: 'nl-BE',
            locales: ['nl', 'nl-NL', 'nl-BE'],
          },
          {
            http: true,
            domain: 'example.fr',
            defaultLocale: 'fr',
            locales: ['fr-BE'],
          },
        ],
      })
    })

    it('should output correct prerender-manifest', async () => {
      const prerenderManifest = await fs.readJSON(
        join(appDir, '.next/prerender-manifest.json')
      )

      for (const key of Object.keys(prerenderManifest.dynamicRoutes)) {
        const item = prerenderManifest.dynamicRoutes[key]
        item.routeRegex = normalizeRegEx(item.routeRegex)
        item.dataRouteRegex = normalizeRegEx(item.dataRouteRegex)
      }

      expect(prerenderManifest.routes).toEqual({
        '/': {
          dataRoute: `/_next/data/${buildId}/index.json`,
          initialRevalidateSeconds: false,
          srcRoute: null,
        },
        '/404': {
          dataRoute: `/_next/data/${buildId}/404.json`,
          initialRevalidateSeconds: false,
          srcRoute: null,
        },
        '/en-US/gsp/fallback/first': {
          dataRoute: `/_next/data/${buildId}/en-US/gsp/fallback/first.json`,
          initialRevalidateSeconds: false,
          srcRoute: '/gsp/fallback/[slug]',
        },
        '/en-US/gsp/fallback/second': {
          dataRoute: `/_next/data/${buildId}/en-US/gsp/fallback/second.json`,
          initialRevalidateSeconds: false,
          srcRoute: '/gsp/fallback/[slug]',
        },
        '/en-US/gsp/no-fallback/first': {
          dataRoute: `/_next/data/${buildId}/en-US/gsp/no-fallback/first.json`,
          initialRevalidateSeconds: false,
          srcRoute: '/gsp/no-fallback/[slug]',
        },
        '/en-US/gsp/no-fallback/second': {
          dataRoute: `/_next/data/${buildId}/en-US/gsp/no-fallback/second.json`,
          initialRevalidateSeconds: false,
          srcRoute: '/gsp/no-fallback/[slug]',
        },
        '/en-US/not-found/blocking-fallback/first': {
          dataRoute: `/_next/data/${buildId}/en-US/not-found/blocking-fallback/first.json`,
          initialRevalidateSeconds: false,
          srcRoute: '/not-found/blocking-fallback/[slug]',
        },
        '/en-US/not-found/blocking-fallback/second': {
          dataRoute: `/_next/data/${buildId}/en-US/not-found/blocking-fallback/second.json`,
          initialRevalidateSeconds: false,
          srcRoute: '/not-found/blocking-fallback/[slug]',
        },
        '/en-US/not-found/fallback/first': {
          dataRoute: `/_next/data/${buildId}/en-US/not-found/fallback/first.json`,
          initialRevalidateSeconds: false,
          srcRoute: '/not-found/fallback/[slug]',
        },
        '/en-US/not-found/fallback/second': {
          dataRoute: `/_next/data/${buildId}/en-US/not-found/fallback/second.json`,
          initialRevalidateSeconds: false,
          srcRoute: '/not-found/fallback/[slug]',
        },
        '/frank': {
          dataRoute: `/_next/data/${buildId}/frank.json`,
          initialRevalidateSeconds: false,
          srcRoute: null,
        },
        '/gsp': {
          dataRoute: `/_next/data/${buildId}/gsp.json`,
          srcRoute: null,
          initialRevalidateSeconds: false,
        },
        '/nl-NL/gsp/no-fallback/second': {
          dataRoute: `/_next/data/${buildId}/nl-NL/gsp/no-fallback/second.json`,
          initialRevalidateSeconds: false,
          srcRoute: '/gsp/no-fallback/[slug]',
        },
        '/not-found': {
          dataRoute: `/_next/data/${buildId}/not-found.json`,
          srcRoute: null,
          initialRevalidateSeconds: false,
        },
      })
      expect(prerenderManifest.dynamicRoutes).toEqual({
        '/gsp/fallback/[slug]': {
          routeRegex: normalizeRegEx(
            '^\\/gsp\\/fallback\\/([^\\/]+?)(?:\\/)?$'
          ),
          dataRoute: `/_next/data/${buildId}/gsp/fallback/[slug].json`,
          fallback: '/gsp/fallback/[slug].html',
          dataRouteRegex: normalizeRegEx(
            `^\\/_next\\/data\\/${escapeRegex(
              buildId
            )}\\/gsp\\/fallback\\/([^\\/]+?)\\.json$`
          ),
        },
        '/gsp/no-fallback/[slug]': {
          routeRegex: normalizeRegEx(
            '^\\/gsp\\/no\\-fallback\\/([^\\/]+?)(?:\\/)?$'
          ),
          dataRoute: `/_next/data/${buildId}/gsp/no-fallback/[slug].json`,
          fallback: false,
          dataRouteRegex: normalizeRegEx(
            `^/_next/data/${escapeRegex(
              buildId
            )}/gsp/no\\-fallback/([^/]+?)\\.json$`
          ),
        },
        '/not-found/blocking-fallback/[slug]': {
          dataRoute: `/_next/data/${buildId}/not-found/blocking-fallback/[slug].json`,
          dataRouteRegex: normalizeRegEx(
            `^\\/_next\\/data\\/${escapeRegex(
              buildId
            )}\\/not\\-found\\/blocking\\-fallback\\/([^\\/]+?)\\.json$`
          ),
          fallback: null,
          routeRegex: normalizeRegEx(
            `^\\/not\\-found\\/blocking\\-fallback\\/([^\\/]+?)(?:\\/)?$`
          ),
        },
        '/not-found/fallback/[slug]': {
          dataRoute: `/_next/data/${buildId}/not-found/fallback/[slug].json`,
          dataRouteRegex: normalizeRegEx(
            `^\\/_next\\/data\\/${escapeRegex(
              buildId
            )}\\/not\\-found\\/fallback\\/([^\\/]+?)\\.json$`
          ),
          fallback: '/not-found/fallback/[slug].html',
          routeRegex: normalizeRegEx('^/not\\-found/fallback/([^/]+?)(?:/)?$'),
        },
      })
    })
  }

  it('should apply redirects correctly', async () => {
    for (const path of ['/redirect', '/en-US/redirect', '/nl/redirect']) {
      const res = await fetchViaHTTP(appPort, path, undefined, {
        redirect: 'manual',
      })
      expect(res.status).toBe(307)

      const parsed = url.parse(res.headers.get('location'), true)
      expect(parsed.pathname).toBe('/somewhere-else')
      expect(parsed.query).toEqual({})
    }
  })

  it('should apply headers correctly', async () => {
    for (const path of ['/add-header', '/en-US/add-header', '/nl/add-header']) {
      const res = await fetchViaHTTP(appPort, path, undefined, {
        redirect: 'manual',
      })
      expect(res.status).toBe(404)
      expect(res.headers.get('x-hello')).toBe('world')
    }
  })

  it('should apply rewrites correctly', async () => {
    const checks = [
      {
        locale: 'en-US',
        path: '/rewrite',
      },
      {
        locale: 'en-US',
        path: '/en-US/rewrite',
      },
      {
        locale: 'nl',
        path: '/nl/rewrite',
      },
    ]

    for (const check of checks) {
      const res = await fetchViaHTTP(appPort, check.path, undefined, {
        redirect: 'manual',
      })

      expect(res.status).toBe(200)

      const html = await res.text()
      const $ = cheerio.load(html)
      expect($('html').attr('lang')).toBe(check.locale)
      expect($('#router-locale').text()).toBe(check.locale)
      expect($('#router-pathname').text()).toBe('/another')
      expect($('#router-as-path').text()).toBe('/rewrite')
    }
  })

  it('should navigate with locale prop correctly', async () => {
    const browser = await webdriver(appPort, '/links?nextLocale=fr')
    await addDefaultLocaleCookie(browser)
    await browser.eval('window.beforeNav = 1')

    if (!isDev) {
      await browser.eval(`(function() {
        document.querySelector('#to-gsp').scrollIntoView()
        document.querySelector('#to-fallback-first').scrollIntoView()
        document.querySelector('#to-no-fallback-first').scrollIntoView()
      })()`)

      await check(async () => {
        for (const dataPath of [
          '/fr/gsp.json',
          '/fr/gsp/fallback/first.json',
          '/fr/gsp/fallback/hello.json',
        ]) {
          const found = await browser.eval(`(function() {
            const links = [].slice.call(document.querySelectorAll('link'))

            for (var i = 0; i < links.length; i++) {
              if (links[i].href.indexOf("${dataPath}") > -1) {
                return true
              }
            }
            return false
          })()`)
          return found ? 'yes' : 'no'
        }
      }, 'yes')
    }

    expect(await browser.elementByCss('#router-pathname').text()).toBe('/links')
    expect(await browser.elementByCss('#router-as-path').text()).toBe(
      '/links?nextLocale=fr'
    )
    expect(await browser.elementByCss('#router-locale').text()).toBe('en-US')
    expect(
      JSON.parse(await browser.elementByCss('#router-locales').text())
    ).toEqual(locales)
    expect(
      JSON.parse(await browser.elementByCss('#router-query').text())
    ).toEqual({ nextLocale: 'fr' })
    expect(await browser.elementByCss('html').getAttribute('lang')).toBe(
      'en-US'
    )

    await browser.elementByCss('#to-another').click()
    await browser.waitForElementByCss('#another')

    expect(await browser.elementByCss('#router-pathname').text()).toBe(
      '/another'
    )
    expect(await browser.elementByCss('#router-as-path').text()).toBe(
      '/another'
    )
    expect(await browser.elementByCss('#router-locale').text()).toBe('fr')
    expect(
      JSON.parse(await browser.elementByCss('#router-locales').text())
    ).toEqual(locales)
    expect(
      JSON.parse(await browser.elementByCss('#router-query').text())
    ).toEqual({})
    expect(await browser.elementByCss('html').getAttribute('lang')).toBe('fr')

    let parsedUrl = url.parse(await browser.eval('window.location.href'), true)
    expect(parsedUrl.pathname).toBe('/fr/another')
    expect(parsedUrl.query).toEqual({})

    await browser.eval('window.history.back()')
    await browser.waitForElementByCss('#links')

    expect(await browser.elementByCss('#router-pathname').text()).toBe('/links')
    expect(await browser.elementByCss('#router-as-path').text()).toBe(
      '/links?nextLocale=fr'
    )
    expect(await browser.elementByCss('#router-locale').text()).toBe('en-US')
    expect(
      JSON.parse(await browser.elementByCss('#router-locales').text())
    ).toEqual(locales)
    expect(
      JSON.parse(await browser.elementByCss('#router-query').text())
    ).toEqual({ nextLocale: 'fr' })
    expect(await browser.elementByCss('html').getAttribute('lang')).toBe(
      'en-US'
    )

    parsedUrl = url.parse(await browser.eval('window.location.href'), true)
    expect(parsedUrl.pathname).toBe('/links')
    expect(parsedUrl.query).toEqual({ nextLocale: 'fr' })

    await browser.eval('window.history.forward()')
    await browser.waitForElementByCss('#another')

    expect(await browser.elementByCss('#router-pathname').text()).toBe(
      '/another'
    )
    expect(await browser.elementByCss('#router-as-path').text()).toBe(
      '/another'
    )
    expect(await browser.elementByCss('#router-locale').text()).toBe('fr')
    expect(
      JSON.parse(await browser.elementByCss('#router-locales').text())
    ).toEqual(locales)
    expect(
      JSON.parse(await browser.elementByCss('#router-query').text())
    ).toEqual({})
    expect(await browser.elementByCss('html').getAttribute('lang')).toBe('fr')

    parsedUrl = url.parse(await browser.eval('window.location.href'), true)
    expect(parsedUrl.pathname).toBe('/fr/another')
    expect(parsedUrl.query).toEqual({})
    expect(await browser.eval('window.beforeNav')).toBe(1)
    expect(await browser.eval('window.caughtWarns')).toEqual([])
  })

  it('should navigate with locale prop correctly GSP', async () => {
    const browser = await webdriver(appPort, '/links?nextLocale=nl')
    await addDefaultLocaleCookie(browser)
    await browser.eval('window.beforeNav = 1')

    expect(await browser.elementByCss('#router-pathname').text()).toBe('/links')
    expect(await browser.elementByCss('#router-as-path').text()).toBe(
      '/links?nextLocale=nl'
    )
    expect(await browser.elementByCss('#router-locale').text()).toBe('en-US')
    expect(
      JSON.parse(await browser.elementByCss('#router-locales').text())
    ).toEqual(locales)
    expect(
      JSON.parse(await browser.elementByCss('#router-query').text())
    ).toEqual({ nextLocale: 'nl' })
    expect(await browser.elementByCss('html').getAttribute('lang')).toBe(
      'en-US'
    )

    await browser.elementByCss('#to-fallback-first').click()
    await browser.waitForElementByCss('#gsp')

    expect(await browser.elementByCss('#router-pathname').text()).toBe(
      '/gsp/fallback/[slug]'
    )
    expect(await browser.elementByCss('#router-as-path').text()).toBe(
      '/gsp/fallback/first'
    )
    expect(await browser.elementByCss('#router-locale').text()).toBe('nl')
    expect(
      JSON.parse(await browser.elementByCss('#router-locales').text())
    ).toEqual(locales)
    expect(
      JSON.parse(await browser.elementByCss('#router-query').text())
    ).toEqual({ slug: 'first' })
    expect(await browser.elementByCss('html').getAttribute('lang')).toBe('nl')

    let parsedUrl = url.parse(await browser.eval('window.location.href'), true)
    expect(parsedUrl.pathname).toBe('/nl/gsp/fallback/first')
    expect(parsedUrl.query).toEqual({})

    await browser.eval('window.history.back()')
    await browser.waitForElementByCss('#links')

    expect(await browser.elementByCss('#router-pathname').text()).toBe('/links')
    expect(await browser.elementByCss('#router-as-path').text()).toBe(
      '/links?nextLocale=nl'
    )
    expect(await browser.elementByCss('#router-locale').text()).toBe('en-US')
    expect(
      JSON.parse(await browser.elementByCss('#router-locales').text())
    ).toEqual(locales)
    expect(
      JSON.parse(await browser.elementByCss('#router-query').text())
    ).toEqual({ nextLocale: 'nl' })
    expect(await browser.elementByCss('html').getAttribute('lang')).toBe(
      'en-US'
    )

    parsedUrl = url.parse(await browser.eval('window.location.href'), true)
    expect(parsedUrl.pathname).toBe('/links')
    expect(parsedUrl.query).toEqual({ nextLocale: 'nl' })

    await browser.eval('window.history.forward()')
    await browser.waitForElementByCss('#gsp')

    expect(await browser.elementByCss('#router-pathname').text()).toBe(
      '/gsp/fallback/[slug]'
    )
    expect(await browser.elementByCss('#router-as-path').text()).toBe(
      '/gsp/fallback/first'
    )
    expect(await browser.elementByCss('#router-locale').text()).toBe('nl')
    expect(
      JSON.parse(await browser.elementByCss('#router-locales').text())
    ).toEqual(locales)
    expect(
      JSON.parse(await browser.elementByCss('#router-query').text())
    ).toEqual({ slug: 'first' })
    expect(await browser.elementByCss('html').getAttribute('lang')).toBe('nl')

    parsedUrl = url.parse(await browser.eval('window.location.href'), true)
    expect(parsedUrl.pathname).toBe('/nl/gsp/fallback/first')
    expect(parsedUrl.query).toEqual({})
    expect(await browser.eval('window.beforeNav')).toBe(1)
    expect(await browser.eval('window.caughtWarns')).toEqual([])
  })

  it('should navigate with locale false correctly', async () => {
    const browser = await webdriver(appPort, '/locale-false?nextLocale=fr')
    await addDefaultLocaleCookie(browser)
    await browser.eval('window.beforeNav = 1')

    if (!isDev) {
      await browser.eval(`(function() {
        document.querySelector('#to-gsp').scrollIntoView()
        document.querySelector('#to-fallback-first').scrollIntoView()
        document.querySelector('#to-no-fallback-first').scrollIntoView()
      })()`)

      await check(async () => {
        for (const dataPath of [
          '/fr/gsp.json',
          '/fr/gsp/fallback/first.json',
          '/fr/gsp/fallback/hello.json',
        ]) {
          const found = await browser.eval(`(function() {
            const links = [].slice.call(document.querySelectorAll('link'))

            for (var i = 0; i < links.length; i++) {
              if (links[i].href.indexOf("${dataPath}") > -1) {
                return true
              }
            }
            return false
          })()`)
          return found ? 'yes' : 'no'
        }
      }, 'yes')
    }

    expect(await browser.elementByCss('#router-pathname').text()).toBe(
      '/locale-false'
    )
    expect(await browser.elementByCss('#router-as-path').text()).toBe(
      '/locale-false?nextLocale=fr'
    )
    expect(await browser.elementByCss('#router-locale').text()).toBe('en-US')
    expect(
      JSON.parse(await browser.elementByCss('#router-locales').text())
    ).toEqual(locales)
    expect(
      JSON.parse(await browser.elementByCss('#router-query').text())
    ).toEqual({ nextLocale: 'fr' })
    expect(await browser.elementByCss('html').getAttribute('lang')).toBe(
      'en-US'
    )

    await browser.elementByCss('#to-another').click()
    await browser.waitForElementByCss('#another')

    expect(await browser.elementByCss('#router-pathname').text()).toBe(
      '/another'
    )
    expect(await browser.elementByCss('#router-as-path').text()).toBe(
      '/another'
    )
    expect(await browser.elementByCss('#router-locale').text()).toBe('fr')
    expect(
      JSON.parse(await browser.elementByCss('#router-locales').text())
    ).toEqual(locales)
    expect(
      JSON.parse(await browser.elementByCss('#router-query').text())
    ).toEqual({})
    expect(await browser.elementByCss('html').getAttribute('lang')).toBe('fr')

    let parsedUrl = url.parse(await browser.eval('window.location.href'), true)
    expect(parsedUrl.pathname).toBe('/fr/another')
    expect(parsedUrl.query).toEqual({})

    await browser.eval('window.history.back()')
    await browser.waitForElementByCss('#links')

    expect(await browser.elementByCss('#router-pathname').text()).toBe(
      '/locale-false'
    )
    expect(await browser.elementByCss('#router-as-path').text()).toBe(
      '/locale-false?nextLocale=fr'
    )
    expect(await browser.elementByCss('#router-locale').text()).toBe('en-US')
    expect(
      JSON.parse(await browser.elementByCss('#router-locales').text())
    ).toEqual(locales)
    expect(
      JSON.parse(await browser.elementByCss('#router-query').text())
    ).toEqual({ nextLocale: 'fr' })
    expect(await browser.elementByCss('html').getAttribute('lang')).toBe(
      'en-US'
    )

    parsedUrl = url.parse(await browser.eval('window.location.href'), true)
    expect(parsedUrl.pathname).toBe('/locale-false')
    expect(parsedUrl.query).toEqual({ nextLocale: 'fr' })

    await browser.eval('window.history.forward()')
    await browser.waitForElementByCss('#another')

    expect(await browser.elementByCss('#router-pathname').text()).toBe(
      '/another'
    )
    expect(await browser.elementByCss('#router-as-path').text()).toBe(
      '/another'
    )
    expect(await browser.elementByCss('#router-locale').text()).toBe('fr')
    expect(
      JSON.parse(await browser.elementByCss('#router-locales').text())
    ).toEqual(locales)
    expect(
      JSON.parse(await browser.elementByCss('#router-query').text())
    ).toEqual({})
    expect(await browser.elementByCss('html').getAttribute('lang')).toBe('fr')

    parsedUrl = url.parse(await browser.eval('window.location.href'), true)
    expect(parsedUrl.pathname).toBe('/fr/another')
    expect(parsedUrl.query).toEqual({})
    expect(await browser.eval('window.beforeNav')).toBe(1)
    expect(await browser.eval('window.caughtWarns')).toEqual([])
  })

  it('should navigate with locale false correctly GSP', async () => {
    const browser = await webdriver(appPort, '/locale-false?nextLocale=nl')
    await addDefaultLocaleCookie(browser)
    await browser.eval('window.beforeNav = 1')

    expect(await browser.elementByCss('#router-pathname').text()).toBe(
      '/locale-false'
    )
    expect(await browser.elementByCss('#router-as-path').text()).toBe(
      '/locale-false?nextLocale=nl'
    )
    expect(await browser.elementByCss('#router-locale').text()).toBe('en-US')
    expect(
      JSON.parse(await browser.elementByCss('#router-locales').text())
    ).toEqual(locales)
    expect(
      JSON.parse(await browser.elementByCss('#router-query').text())
    ).toEqual({ nextLocale: 'nl' })
    expect(await browser.elementByCss('html').getAttribute('lang')).toBe(
      'en-US'
    )

    await browser.elementByCss('#to-fallback-first').click()
    await browser.waitForElementByCss('#gsp')

    expect(await browser.elementByCss('#router-pathname').text()).toBe(
      '/gsp/fallback/[slug]'
    )
    expect(await browser.elementByCss('#router-as-path').text()).toBe(
      '/gsp/fallback/first'
    )
    expect(await browser.elementByCss('#router-locale').text()).toBe('nl')
    expect(
      JSON.parse(await browser.elementByCss('#router-locales').text())
    ).toEqual(locales)
    expect(
      JSON.parse(await browser.elementByCss('#router-query').text())
    ).toEqual({ slug: 'first' })
    expect(await browser.elementByCss('html').getAttribute('lang')).toBe('nl')

    let parsedUrl = url.parse(await browser.eval('window.location.href'), true)
    expect(parsedUrl.pathname).toBe('/nl/gsp/fallback/first')
    expect(parsedUrl.query).toEqual({})

    await browser.eval('window.history.back()')
    await browser.waitForElementByCss('#links')

    expect(await browser.elementByCss('#router-pathname').text()).toBe(
      '/locale-false'
    )
    expect(await browser.elementByCss('#router-as-path').text()).toBe(
      '/locale-false?nextLocale=nl'
    )
    expect(await browser.elementByCss('#router-locale').text()).toBe('en-US')
    expect(
      JSON.parse(await browser.elementByCss('#router-locales').text())
    ).toEqual(locales)
    expect(
      JSON.parse(await browser.elementByCss('#router-query').text())
    ).toEqual({ nextLocale: 'nl' })
    expect(await browser.elementByCss('html').getAttribute('lang')).toBe(
      'en-US'
    )

    parsedUrl = url.parse(await browser.eval('window.location.href'), true)
    expect(parsedUrl.pathname).toBe('/locale-false')
    expect(parsedUrl.query).toEqual({ nextLocale: 'nl' })

    await browser.eval('window.history.forward()')
    await browser.waitForElementByCss('#gsp')

    expect(await browser.elementByCss('#router-pathname').text()).toBe(
      '/gsp/fallback/[slug]'
    )
    expect(await browser.elementByCss('#router-as-path').text()).toBe(
      '/gsp/fallback/first'
    )
    expect(await browser.elementByCss('#router-locale').text()).toBe('nl')
    expect(
      JSON.parse(await browser.elementByCss('#router-locales').text())
    ).toEqual(locales)
    expect(
      JSON.parse(await browser.elementByCss('#router-query').text())
    ).toEqual({ slug: 'first' })
    expect(await browser.elementByCss('html').getAttribute('lang')).toBe('nl')

    parsedUrl = url.parse(await browser.eval('window.location.href'), true)
    expect(parsedUrl.pathname).toBe('/nl/gsp/fallback/first')
    expect(parsedUrl.query).toEqual({})
    expect(await browser.eval('window.beforeNav')).toBe(1)
    expect(await browser.eval('window.caughtWarns')).toEqual([])
  })

  it('should update asPath on the client correctly', async () => {
    for (const check of ['en', 'En']) {
      const browser = await webdriver(appPort, `/${check}`)

      expect(await browser.elementByCss('html').getAttribute('lang')).toBe('en')
      expect(await browser.elementByCss('#router-locale').text()).toBe('en')
      expect(
        JSON.parse(await browser.elementByCss('#router-locales').text())
      ).toEqual(locales)
      expect(await browser.elementByCss('#router-as-path').text()).toBe('/')
      expect(await browser.elementByCss('#router-pathname').text()).toBe('/')
    }
  })

  if (!isDev) {
    it('should handle fallback correctly after generating', async () => {
      const browser = await webdriver(
        appPort,
        '/en/gsp/fallback/hello-fallback'
      )

      // wait for the fallback to be generated/stored to ISR cache
      browser.waitForElementByCss('#gsp')

      // now make sure we're serving the previously generated file from the cache
      const html = await renderViaHTTP(
        appPort,
        '/en/gsp/fallback/hello-fallback'
      )
      const $ = cheerio.load(html)

      expect($('#gsp').text()).toBe('gsp page')
      expect($('#router-locale').text()).toBe('en')
      expect(JSON.parse($('#router-locales').text())).toEqual(locales)
      expect($('#router-pathname').text()).toBe('/gsp/fallback/[slug]')
      expect($('#router-as-path').text()).toBe('/gsp/fallback/hello-fallback')
    })
  }

  it('should use correct default locale for locale domains', async () => {
    const res = await fetchViaHTTP(appPort, '/', undefined, {
      headers: {
        host: 'example.fr',
      },
    })

    expect(res.status).toBe(200)

    const html = await res.text()
    const $ = cheerio.load(html)

    expect($('html').attr('lang')).toBe('fr')
    expect($('#router-locale').text()).toBe('fr')
    expect($('#router-as-path').text()).toBe('/')
    expect($('#router-pathname').text()).toBe('/')
    // expect(JSON.parse($('#router-locales').text())).toEqual(['fr','fr-BE'])
    expect(JSON.parse($('#router-locales').text())).toEqual(locales)

    const res2 = await fetchViaHTTP(appPort, '/', undefined, {
      headers: {
        host: 'example.be',
      },
    })

    expect(res2.status).toBe(200)

    const html2 = await res2.text()
    const $2 = cheerio.load(html2)

    expect($2('html').attr('lang')).toBe('nl-BE')
    expect($2('#router-locale').text()).toBe('nl-BE')
    expect($2('#router-as-path').text()).toBe('/')
    expect($2('#router-pathname').text()).toBe('/')
    // expect(JSON.parse($2('#router-locales').text())).toEqual(['nl-BE','fr-BE'])
    expect(JSON.parse($2('#router-locales').text())).toEqual(locales)
  })

  it('should not strip locale prefix for default locale with locale domains', async () => {
    const res = await fetchViaHTTP(appPort, '/fr', undefined, {
      headers: {
        host: 'example.fr',
      },
      redirect: 'manual',
    })

    expect(res.status).toBe(200)

    // const result = url.parse(res.headers.get('location'), true)
    // expect(result.pathname).toBe('/')
    // expect(result.query).toEqual({})

    const res2 = await fetchViaHTTP(appPort, '/nl-BE', undefined, {
      headers: {
        host: 'example.be',
      },
      redirect: 'manual',
    })

    expect(res2.status).toBe(200)

    // const result2 = url.parse(res2.headers.get('location'), true)
    // expect(result2.pathname).toBe('/')
    // expect(result2.query).toEqual({})
  })

  // ('should set locale cookie when removing default locale and accept-lang doesnt match', async () => {
  //   const res = await fetchViaHTTP(appPort, '/en-US', undefined, {
  //     headers: {
  //       'accept-language': 'nl',
  //     },
  //     redirect: 'manual',
  //   })

  //   expect(res.status).toBe(307)

  //   const parsedUrl = url.parse(res.headers.get('location'), true)
  //   expect(parsedUrl.pathname).toBe('/')
  //   expect(parsedUrl.query).toEqual({})
  //   expect(res.headers.get('set-cookie')).toContain('NEXT_LOCALE=en-US')
  // })

  it('should not redirect to accept-lang preferred locale with locale cookie', async () => {
    const res = await fetchViaHTTP(appPort, '/', undefined, {
      headers: {
        'accept-language': 'nl',
        cookie: 'NEXT_LOCALE=en-US',
      },
      redirect: 'manual',
    })

    expect(res.status).toBe(200)

    const html = await res.text()
    const $ = cheerio.load(html)

    expect($('#router-locale').text()).toBe('en-US')
    expect(JSON.parse($('#router-locales').text())).toEqual(locales)
    expect($('html').attr('lang')).toBe('en-US')
    expect($('#router-pathname').text()).toBe('/')
    expect($('#router-as-path').text()).toBe('/')
  })

  it('should redirect to correct locale domain', async () => {
    const checks = [
      // test domain, locale prefix, redirect result
      // ['example.be', 'nl-BE', 'http://example.be/'],
      ['example.be', 'fr', 'http://example.fr/'],
      ['example.fr', 'nl-BE', 'http://example.be/'],
      // ['example.fr', 'fr', 'http://example.fr/'],
    ]

    for (const check of checks) {
      const [domain, locale, location] = check

      const res = await fetchViaHTTP(appPort, `/`, undefined, {
        headers: {
          host: domain,
          'accept-language': locale,
        },
        redirect: 'manual',
      })

      expect(res.status).toBe(307)
      expect(res.headers.get('location')).toBe(location)
    }
  })

  it('should handle locales with domain', async () => {
    const domainItems = [
      {
        // used for testing, this should not be needed in most cases
        // as production domains should always use https
        http: true,
        domain: 'example.be',
        defaultLocale: 'nl-BE',
        locales: ['nl', 'nl-NL', 'nl-BE'],
      },
      {
        http: true,
        domain: 'example.fr',
        defaultLocale: 'fr',
        locales: ['fr-BE'],
      },
    ]
    const domainLocales = domainItems.reduce((prev, cur) => {
      return [...prev, ...cur.locales]
    }, [])

    const checkDomainLocales = async (
      domainDefault = '',
      domain = '',
      locale = ''
    ) => {
      const res = await fetchViaHTTP(appPort, `/`, undefined, {
        headers: {
          host: domain,
          'accept-language': locale,
        },
        redirect: 'manual',
      })
      const expectedDomainItem = domainItems.find(
        (item) => item.defaultLocale === locale || item.locales.includes(locale)
      )
      const shouldRedirect =
        expectedDomainItem.domain !== domain ||
        locale !== expectedDomainItem.defaultLocale

      expect(res.status).toBe(shouldRedirect ? 307 : 200)

      if (shouldRedirect) {
        const parsedUrl = url.parse(res.headers.get('location'), true)

        expect(parsedUrl.pathname).toBe(
          `/${expectedDomainItem.defaultLocale === locale ? '' : locale}`
        )
        expect(parsedUrl.query).toEqual({})
        expect(parsedUrl.hostname).toBe(expectedDomainItem.domain)
      } else {
        const html = await res.text()
        const $ = cheerio.load(html)

        expect($('html').attr('lang')).toBe(locale)
        expect($('#router-locale').text()).toBe(locale)
        expect(JSON.parse($('#router-locales').text())).toEqual(locales)
      }
    }

    for (const item of domainItems) {
      for (const locale of domainLocales) {
        await checkDomainLocales(item.defaultLocale, item.domain, locale)
      }
    }
  })

  it('should generate AMP pages with all locales', async () => {
    for (const locale of locales) {
      const localePath = locale !== 'en-US' ? `/${locale}` : ''
      const html = await renderViaHTTP(appPort, `${localePath}/amp/amp-hybrid`)
      const $ = cheerio.load(html)
      expect($('html').attr('lang')).toBe(locale)
      expect($('#is-amp').text()).toBe('no')
      expect($('#router-locale').text()).toBe(locale)
      expect(JSON.parse($('#router-locales').text())).toEqual(locales)
      expect($('#router-pathname').text()).toBe('/amp/amp-hybrid')
      expect($('#router-as-path').text()).toBe('/amp/amp-hybrid')
      expect(JSON.parse($('#router-query').text())).toEqual({})

      const amphtmlPath = `${localePath}/amp/amp-hybrid${
        isDev ? '?amp=1' : '.amp'
      }`
      expect($('link[rel=amphtml]').attr('href')).toBe(amphtmlPath)

      const html2 = await renderViaHTTP(appPort, amphtmlPath)
      const $2 = cheerio.load(html2)
      expect($2('html').attr('lang')).toBe(locale)
      expect($2('#is-amp').text()).toBe('yes')
      expect($2('#router-locale').text()).toBe(locale)
      expect(JSON.parse($2('#router-locales').text())).toEqual(locales)
      expect($2('#router-pathname').text()).toBe('/amp/amp-hybrid')
      expect($2('#router-as-path').text()).toBe('/amp/amp-hybrid')
      expect(JSON.parse($2('#router-query').text())).toEqual({ amp: '1' })
      expect($2('link[rel=amphtml]').attr('href')).toBeFalsy()
    }
  })

  it('should work with AMP first page with all locales', async () => {
    for (const locale of locales) {
      const localePath = locale !== 'en-US' ? `/${locale}` : ''
      const html = await renderViaHTTP(appPort, `${localePath}/amp/amp-first`)
      const $ = cheerio.load(html)
      expect($('html').attr('lang')).toBe(locale)
      expect($('#is-amp').text()).toBe('yes')
      expect($('#router-locale').text()).toBe(locale)
      expect(JSON.parse($('#router-locales').text())).toEqual(locales)
      expect($('#router-pathname').text()).toBe('/amp/amp-first')
      expect($('#router-as-path').text()).toBe('/amp/amp-first')
      expect(JSON.parse($('#router-query').text())).toEqual({})
      expect($('link[rel=amphtml]').attr('href')).toBeFalsy()
    }
  })

  it('should generate fallbacks with all locales', async () => {
    for (const locale of locales) {
      const html = await renderViaHTTP(
        appPort,
        `/${locale}/gsp/fallback/${Math.random()}`
      )
      const $ = cheerio.load(html)
      expect($('html').attr('lang')).toBe(locale)
    }
  })

  it('should generate auto-export page with all locales', async () => {
    for (const locale of locales) {
      const html = await renderViaHTTP(appPort, `/${locale}`)
      const $ = cheerio.load(html)
      expect($('html').attr('lang')).toBe(locale)
      expect($('#router-locale').text()).toBe(locale)
      expect($('#router-as-path').text()).toBe('/')
      expect($('#router-pathname').text()).toBe('/')
      expect(JSON.parse($('#router-locales').text())).toEqual(locales)

      const html2 = await renderViaHTTP(appPort, `/${locale}/auto-export`)
      const $2 = cheerio.load(html2)
      expect($2('html').attr('lang')).toBe(locale)
      expect($2('#router-locale').text()).toBe(locale)
      expect($2('#router-as-path').text()).toBe('/auto-export')
      expect($2('#router-pathname').text()).toBe('/auto-export')
      expect(JSON.parse($2('#router-locales').text())).toEqual(locales)
    }
  })

  it('should generate non-dynamic GSP page with all locales', async () => {
    for (const locale of locales) {
      const html = await renderViaHTTP(appPort, `/${locale}/gsp`)
      const $ = cheerio.load(html)
      expect($('html').attr('lang')).toBe(locale)
      expect($('#router-locale').text()).toBe(locale)
      expect($('#router-as-path').text()).toBe('/gsp')
      expect($('#router-pathname').text()).toBe('/gsp')
      expect(JSON.parse($('#router-locales').text())).toEqual(locales)

      // make sure locale is case-insensitive
      const html2 = await renderViaHTTP(appPort, `/${locale.toUpperCase()}/gsp`)
      const $2 = cheerio.load(html2)
      expect($2('html').attr('lang')).toBe(locale)
      expect($2('#router-locale').text()).toBe(locale)
      expect($2('#router-as-path').text()).toBe('/gsp')
      expect($2('#router-pathname').text()).toBe('/gsp')
      expect(JSON.parse($2('#router-locales').text())).toEqual(locales)
    }
  })

  if (!isDev) {
    it('should not output GSP pages that returned notFound', async () => {
      const skippedLocales = ['en', 'nl']

      for (const locale of locales) {
        const pagePath = join(buildPagesDir, locale, 'not-found.html')
        const dataPath = join(buildPagesDir, locale, 'not-found.json')
        console.log(pagePath)
        expect(await fs.exists(pagePath)).toBe(!skippedLocales.includes(locale))
        expect(await fs.exists(dataPath)).toBe(!skippedLocales.includes(locale))
      }
    })
  }

  it('should 404 for GSP pages that returned notFound', async () => {
    const skippedLocales = ['en', 'nl']

    for (const locale of locales) {
      const res = await fetchViaHTTP(appPort, `/${locale}/not-found`)
      expect(res.status).toBe(skippedLocales.includes(locale) ? 404 : 200)

      if (skippedLocales.includes(locale)) {
        const browser = await webdriver(appPort, `/${locale}/not-found`)
        expect(await browser.elementByCss('html').getAttribute('lang')).toBe(
          locale
        )
        expect(
          await browser.eval('document.documentElement.innerHTML')
        ).toContain('This page could not be found')

        const props = JSON.parse(await browser.elementByCss('#props').text())

        expect(props.is404).toBe(true)
        expect(props.locale).toBe(locale)

        const parsedUrl = url.parse(
          await browser.eval('window.location.href'),
          true
        )
        expect(parsedUrl.pathname).toBe(`/${locale}/not-found`)
        expect(parsedUrl.query).toEqual({})
      }
    }
  })

  it('should transition on client properly for page that starts with locale', async () => {
    const browser = await webdriver(appPort, '/fr')
    await browser.eval(`(function() {
      window.beforeNav = 1
      window.next.router.push('/frank')
    })()`)

    await browser.waitForElementByCss('#frank')

    expect(await browser.elementByCss('#router-locale').text()).toBe('fr')
    expect(
      JSON.parse(await browser.elementByCss('#router-locales').text())
    ).toEqual(locales)
    expect(
      JSON.parse(await browser.elementByCss('#router-query').text())
    ).toEqual({})
    expect(await browser.elementByCss('#router-pathname').text()).toBe('/frank')
    expect(await browser.elementByCss('#router-as-path').text()).toBe('/frank')
    expect(
      url.parse(await browser.eval(() => window.location.href)).pathname
    ).toBe('/fr/frank')
    expect(await browser.eval('window.beforeNav')).toBe(1)
  })

  it('should 404 for GSP that returned notFound on client-transition', async () => {
    const browser = await webdriver(appPort, '/en')
    await browser.eval(`(function() {
      window.beforeNav = 1
      window.next.router.push('/not-found')
    })()`)

    await browser.waitForElementByCss('h1')

    expect(await browser.elementByCss('html').getAttribute('lang')).toBe('en')
    expect(await browser.elementByCss('html').text()).toContain(
      'This page could not be found'
    )
    const props = JSON.parse(await browser.elementByCss('#props').text())

    expect(props.is404).toBe(true)
    expect(props.locale).toBe('en')
    expect(await browser.eval('window.beforeNav')).toBe(null)
  })

  it('should render 404 for fallback page that returned 404 on client transition', async () => {
    const browser = await webdriver(appPort, '/en', true, true)
    await browser.eval(`(function() {
      next.router.push('/not-found/fallback/first')
    })()`)
    await browser.waitForElementByCss('h1')
    await browser.eval('window.beforeNav = 1')

    expect(await browser.elementByCss('html').text()).toContain(
      'This page could not be found'
    )
    const props = JSON.parse(await browser.elementByCss('#props').text())

    expect(props.is404).toBe(true)
    expect(props.locale).toBe('en')
    expect(await browser.elementByCss('html').getAttribute('lang')).toBe('en')

    const parsedUrl = url.parse(
      await browser.eval('window.location.href'),
      true
    )
    expect(parsedUrl.pathname).toBe('/en/not-found/fallback/first')
    expect(parsedUrl.query).toEqual({})

    if (isDev) {
      // make sure page doesn't reload un-necessarily in development
      await waitFor(10 * 1000)
    }
    expect(await browser.eval('window.beforeNav')).toBe(1)
  })

  it('should render 404 for fallback page that returned 404', async () => {
    const browser = await webdriver(
      appPort,
      '/en/not-found/fallback/first',
      true,
      true
    )
    await browser.waitForElementByCss('h1')
    await browser.eval('window.beforeNav = 1')

    expect(await browser.elementByCss('html').text()).toContain(
      'This page could not be found'
    )
    const props = JSON.parse(await browser.elementByCss('#props').text())

    expect(props.is404).toBe(true)
    expect(props.locale).toBe('en')
    expect(await browser.elementByCss('html').getAttribute('lang')).toBe('en')

    const parsedUrl = url.parse(
      await browser.eval('window.location.href'),
      true
    )
    expect(parsedUrl.pathname).toBe('/en/not-found/fallback/first')
    expect(parsedUrl.query).toEqual({})

    if (isDev) {
      // make sure page doesn't reload un-necessarily in development
      await waitFor(10 * 1000)
    }
    expect(await browser.eval('window.beforeNav')).toBe(1)
  })

  it('should render 404 for blocking fallback page that returned 404 on client transition', async () => {
    const browser = await webdriver(appPort, '/en', true, true)
    await browser.eval(`(function() {
      next.router.push('/not-found/blocking-fallback/first')
    })()`)
    await browser.waitForElementByCss('h1')
    await browser.eval('window.beforeNav = 1')

    expect(await browser.elementByCss('html').text()).toContain(
      'This page could not be found'
    )
    const props = JSON.parse(await browser.elementByCss('#props').text())

    expect(props.is404).toBe(true)
    expect(props.locale).toBe('en')
    expect(await browser.elementByCss('html').getAttribute('lang')).toBe('en')

    const parsedUrl = url.parse(
      await browser.eval('window.location.href'),
      true
    )
    expect(parsedUrl.pathname).toBe('/en/not-found/blocking-fallback/first')
    expect(parsedUrl.query).toEqual({})

    if (isDev) {
      // make sure page doesn't reload un-necessarily in development
      await waitFor(10 * 1000)
    }
    expect(await browser.eval('window.beforeNav')).toBe(1)
  })

  it('should render 404 for blocking fallback page that returned 404', async () => {
    const browser = await webdriver(
      appPort,
      '/en/not-found/blocking-fallback/first',
      true,
      true
    )
    await browser.waitForElementByCss('h1')
    await browser.eval('window.beforeNav = 1')

    expect(await browser.elementByCss('html').text()).toContain(
      'This page could not be found'
    )
    const props = JSON.parse(await browser.elementByCss('#props').text())

    expect(props.is404).toBe(true)
    expect(props.locale).toBe('en')
    expect(await browser.elementByCss('html').getAttribute('lang')).toBe('en')

    const parsedUrl = url.parse(
      await browser.eval('window.location.href'),
      true
    )
    expect(parsedUrl.pathname).toBe('/en/not-found/blocking-fallback/first')
    expect(parsedUrl.query).toEqual({})

    if (isDev) {
      // make sure page doesn't reload un-necessarily in development
      await waitFor(10 * 1000)
    }
    expect(await browser.eval('window.beforeNav')).toBe(1)
  })

  it('should not remove locale prefix for default locale', async () => {
    const res = await fetchViaHTTP(appPort, '/en-US', undefined, {
      redirect: 'manual',
      headers: {
        'Accept-Language': 'en-US;q=0.9',
      },
    })

    expect(res.status).toBe(200)

    // const parsedUrl = url.parse(res.headers.get('location'), true)

    // expect(parsedUrl.pathname).toBe('/')
    // expect(parsedUrl.query).toEqual({})

    // make sure locale is case-insensitive
    const res2 = await fetchViaHTTP(appPort, '/eN-Us', undefined, {
      redirect: 'manual',
      headers: {
        'Accept-Language': 'en-US;q=0.9',
      },
    })

    expect(res2.status).toBe(200)

    // const parsedUrl2 = url.parse(res.headers.get('location'), true)

    // expect(parsedUrl2.pathname).toBe('/')
    // expect(parsedUrl2.query).toEqual({})
  })

  it('should load getStaticProps page correctly SSR (default locale no prefix)', async () => {
    const html = await renderViaHTTP(appPort, '/gsp')
    const $ = cheerio.load(html)

    expect(JSON.parse($('#props').text())).toEqual({
      locale: 'en-US',
      locales,
      defaultLocale: 'en-US',
    })
    expect($('#router-locale').text()).toBe('en-US')
    expect(JSON.parse($('#router-locales').text())).toEqual(locales)
    expect($('html').attr('lang')).toBe('en-US')
  })

  it('should load getStaticProps fallback prerender page correctly SSR (default locale no prefix)', async () => {
    const html = await renderViaHTTP(appPort, '/gsp/fallback/first')
    const $ = cheerio.load(html)

    expect(JSON.parse($('#props').text())).toEqual({
      locale: 'en-US',
      locales,
      params: {
        slug: 'first',
      },
      defaultLocale: 'en-US',
    })
    expect(JSON.parse($('#router-query').text())).toEqual({
      slug: 'first',
    })
    expect($('#router-locale').text()).toBe('en-US')
    expect(JSON.parse($('#router-locales').text())).toEqual(locales)
    expect($('html').attr('lang')).toBe('en-US')
  })

  it('should load getStaticProps fallback non-prerender page correctly (default locale no prefix', async () => {
    const browser = await webdriver(appPort, '/gsp/fallback/another')

    await browser.waitForElementByCss('#props')

    expect(JSON.parse(await browser.elementByCss('#props').text())).toEqual({
      locale: 'en-US',
      locales,
      params: {
        slug: 'another',
      },
      defaultLocale: 'en-US',
    })
    expect(
      JSON.parse(await browser.elementByCss('#router-query').text())
    ).toEqual({
      slug: 'another',
    })
    expect(await browser.elementByCss('#router-locale').text()).toBe('en-US')
    expect(
      JSON.parse(await browser.elementByCss('#router-locales').text())
    ).toEqual(locales)
  })

  it('should redirect to locale prefixed route for /', async () => {
    const res = await fetchViaHTTP(appPort, '/', undefined, {
      redirect: 'manual',
      headers: {
        'Accept-Language': 'nl-NL,nl;q=0.9,en-US;q=0.8,en;q=0.7',
      },
    })
    expect(res.status).toBe(307)

    const parsedUrl = url.parse(res.headers.get('location'), true)
    expect(parsedUrl.pathname).toBe('/nl-NL')
    expect(parsedUrl.query).toEqual({})

    const res2 = await fetchViaHTTP(
      appPort,
      '/',
      { hello: 'world' },
      {
        redirect: 'manual',
        headers: {
          'Accept-Language': 'en;q=0.9',
        },
      }
    )
    expect(res2.status).toBe(307)

    const parsedUrl2 = url.parse(res2.headers.get('location'), true)
    expect(parsedUrl2.pathname).toBe('/en')
    expect(parsedUrl2.query).toEqual({ hello: 'world' })
  })

  it('should use default locale for / without accept-language', async () => {
    const res = await fetchViaHTTP(appPort, '/', undefined, {
      redirect: 'manual',
    })
    expect(res.status).toBe(200)

    const html = await res.text()
    const $ = cheerio.load(html)

    expect($('#router-locale').text()).toBe('en-US')
    expect(JSON.parse($('#router-locales').text())).toEqual(locales)
    expect(JSON.parse($('#router-query').text())).toEqual({})
    expect($('#router-pathname').text()).toBe('/')
    expect($('#router-as-path').text()).toBe('/')

    const res2 = await fetchViaHTTP(
      appPort,
      '/',
      { hello: 'world' },
      {
        redirect: 'manual',
      }
    )
    expect(res2.status).toBe(200)

    const html2 = await res2.text()
    const $2 = cheerio.load(html2)

    expect($2('#router-locale').text()).toBe('en-US')
    expect(JSON.parse($2('#router-locales').text())).toEqual(locales)
    // page is auto-export so query isn't hydrated until client
    expect(JSON.parse($2('#router-query').text())).toEqual({})
    expect($2('#router-pathname').text()).toBe('/')
    // expect($2('#router-as-path').text()).toBe('/')
  })

  it('should load getStaticProps page correctly SSR', async () => {
    const html = await renderViaHTTP(appPort, '/en-US/gsp')
    const $ = cheerio.load(html)

    expect(JSON.parse($('#props').text())).toEqual({
      locale: 'en-US',
      locales,
      defaultLocale: 'en-US',
    })
    expect($('#router-locale').text()).toBe('en-US')
    expect(JSON.parse($('#router-locales').text())).toEqual(locales)
    expect($('html').attr('lang')).toBe('en-US')
  })

  it('should load getStaticProps fallback prerender page correctly SSR', async () => {
    const html = await renderViaHTTP(appPort, '/en-US/gsp/fallback/first')
    const $ = cheerio.load(html)

    expect(JSON.parse($('#props').text())).toEqual({
      locale: 'en-US',
      locales,
      params: {
        slug: 'first',
      },
      defaultLocale: 'en-US',
    })
    expect(JSON.parse($('#router-query').text())).toEqual({
      slug: 'first',
    })
    expect($('#router-locale').text()).toBe('en-US')
    expect(JSON.parse($('#router-locales').text())).toEqual(locales)
    expect($('html').attr('lang')).toBe('en-US')
  })

  it('should load getStaticProps fallback non-prerender page correctly', async () => {
    const browser = await webdriver(appPort, '/en/gsp/fallback/another')

    await browser.waitForElementByCss('#props')

    expect(JSON.parse(await browser.elementByCss('#props').text())).toEqual({
      locale: 'en',
      locales,
      params: {
        slug: 'another',
      },
      defaultLocale: 'en-US',
    })
    expect(
      JSON.parse(await browser.elementByCss('#router-query').text())
    ).toEqual({
      slug: 'another',
    })
    expect(await browser.elementByCss('#router-locale').text()).toBe('en')
    expect(
      JSON.parse(await browser.elementByCss('#router-locales').text())
    ).toEqual(locales)

    expect(await browser.elementByCss('html').getAttribute('lang')).toBe('en')
  })

  it('should load getServerSideProps page correctly SSR (default locale no prefix)', async () => {
    const html = await renderViaHTTP(appPort, '/gssp')
    const $ = cheerio.load(html)

    expect(JSON.parse($('#props').text())).toEqual({
      locale: 'en-US',
      locales,
      defaultLocale: 'en-US',
    })
    expect($('#router-locale').text()).toBe('en-US')
    expect(JSON.parse($('#router-locales').text())).toEqual(locales)
    expect(JSON.parse($('#router-query').text())).toEqual({})
    expect($('html').attr('lang')).toBe('en-US')
  })

  it('should navigate client side for default locale with no prefix', async () => {
    const browser = await webdriver(appPort, '/')
    await addDefaultLocaleCookie(browser)

    const checkIndexValues = async () => {
      expect(await browser.elementByCss('#router-locale').text()).toBe('en-US')
      expect(
        JSON.parse(await browser.elementByCss('#router-locales').text())
      ).toEqual(locales)
      expect(
        JSON.parse(await browser.elementByCss('#router-query').text())
      ).toEqual({})
      expect(await browser.elementByCss('#router-pathname').text()).toBe('/')
      expect(await browser.elementByCss('#router-as-path').text()).toBe('/')
      expect(
        url.parse(await browser.eval(() => window.location.href)).pathname
      ).toBe('/')
    }

    await checkIndexValues()

    await browser.elementByCss('#to-another').click()
    await browser.waitForElementByCss('#another')

    expect(JSON.parse(await browser.elementByCss('#props').text())).toEqual({
      locale: 'en-US',
      locales,
      defaultLocale: 'en-US',
    })
    expect(await browser.elementByCss('#router-locale').text()).toBe('en-US')
    expect(
      JSON.parse(await browser.elementByCss('#router-locales').text())
    ).toEqual(locales)
    expect(
      JSON.parse(await browser.elementByCss('#router-query').text())
    ).toEqual({})
    expect(await browser.elementByCss('#router-pathname').text()).toBe(
      '/another'
    )
    expect(await browser.elementByCss('#router-as-path').text()).toBe(
      '/another'
    )
    expect(
      url.parse(await browser.eval(() => window.location.href)).pathname
    ).toBe('/another')

    await browser.elementByCss('#to-index').click()
    await browser.waitForElementByCss('#index')

    await checkIndexValues()

    await browser.elementByCss('#to-gsp').click()
    await browser.waitForElementByCss('#gsp')

    expect(JSON.parse(await browser.elementByCss('#props').text())).toEqual({
      locale: 'en-US',
      locales,
      defaultLocale: 'en-US',
    })
    expect(await browser.elementByCss('#router-locale').text()).toBe('en-US')
    expect(
      JSON.parse(await browser.elementByCss('#router-locales').text())
    ).toEqual(locales)
    expect(
      JSON.parse(await browser.elementByCss('#router-query').text())
    ).toEqual({})
    expect(await browser.elementByCss('#router-pathname').text()).toBe('/gsp')
    expect(await browser.elementByCss('#router-as-path').text()).toBe('/gsp')
    expect(
      url.parse(await browser.eval(() => window.location.href)).pathname
    ).toBe('/gsp')

    await browser.elementByCss('#to-index').click()
    await browser.waitForElementByCss('#index')

    await checkIndexValues()

    await browser.manage().deleteCookie('NEXT_LOCALE')
  })

  it('should load getStaticProps fallback non-prerender page another locale correctly', async () => {
    const browser = await webdriver(appPort, '/nl-NL/gsp/fallback/another')

    await browser.waitForElementByCss('#props')

    expect(JSON.parse(await browser.elementByCss('#props').text())).toEqual({
      locale: 'nl-NL',
      locales,
      params: {
        slug: 'another',
      },
      defaultLocale: 'en-US',
    })
    expect(
      JSON.parse(await browser.elementByCss('#router-query').text())
    ).toEqual({
      slug: 'another',
    })
    expect(await browser.elementByCss('#router-locale').text()).toBe('nl-NL')
    expect(
      JSON.parse(await browser.elementByCss('#router-locales').text())
    ).toEqual(locales)
  })

  it('should load getStaticProps non-fallback correctly', async () => {
    const browser = await webdriver(appPort, '/en-US/gsp/no-fallback/first')

    await browser.waitForElementByCss('#props')

    expect(JSON.parse(await browser.elementByCss('#props').text())).toEqual({
      locale: 'en-US',
      locales,
      params: {
        slug: 'first',
      },
      defaultLocale: 'en-US',
    })
    expect(
      JSON.parse(await browser.elementByCss('#router-query').text())
    ).toEqual({
      slug: 'first',
    })
    expect(await browser.elementByCss('#router-locale').text()).toBe('en-US')
    expect(
      JSON.parse(await browser.elementByCss('#router-locales').text())
    ).toEqual(locales)
    expect(await browser.elementByCss('html').getAttribute('lang')).toBe(
      'en-US'
    )
  })

  it('should load getStaticProps non-fallback correctly another locale', async () => {
    const browser = await webdriver(appPort, '/nl-NL/gsp/no-fallback/second')

    await browser.waitForElementByCss('#props')

    expect(JSON.parse(await browser.elementByCss('#props').text())).toEqual({
      locale: 'nl-NL',
      locales,
      params: {
        slug: 'second',
      },
      defaultLocale: 'en-US',
    })
    expect(
      JSON.parse(await browser.elementByCss('#router-query').text())
    ).toEqual({
      slug: 'second',
    })
    expect(await browser.elementByCss('#router-locale').text()).toBe('nl-NL')
    expect(
      JSON.parse(await browser.elementByCss('#router-locales').text())
    ).toEqual(locales)
    expect(await browser.elementByCss('html').getAttribute('lang')).toBe(
      'nl-NL'
    )
  })

  it('should load getStaticProps non-fallback correctly another locale via cookie', async () => {
    const html = await renderViaHTTP(
      appPort,
      '/nl-NL/gsp/no-fallback/second',
      {},
      {
        headers: {
          cookie: 'NEXT_LOCALE=nl-NL',
        },
      }
    )
    const $ = cheerio.load(html)

    expect(JSON.parse($('#props').text())).toEqual({
      locale: 'nl-NL',
      locales,
      params: {
        slug: 'second',
      },
      defaultLocale: 'en-US',
    })
    expect(JSON.parse($('#router-query').text())).toEqual({
      slug: 'second',
    })
    expect($('#router-locale').text()).toBe('nl-NL')
    expect(JSON.parse($('#router-locales').text())).toEqual(locales)
    expect($('html').attr('lang')).toBe('nl-NL')
  })

  it('should load getServerSideProps page correctly SSR', async () => {
    const html = await renderViaHTTP(appPort, '/en-US/gssp')
    const $ = cheerio.load(html)

    expect(JSON.parse($('#props').text())).toEqual({
      locale: 'en-US',
      locales,
      defaultLocale: 'en-US',
    })
    expect($('#router-locale').text()).toBe('en-US')
    expect(JSON.parse($('#router-locales').text())).toEqual(locales)
    expect(JSON.parse($('#router-query').text())).toEqual({})
    expect($('html').attr('lang')).toBe('en-US')

    const html2 = await renderViaHTTP(appPort, '/nl-NL/gssp')
    const $2 = cheerio.load(html2)

    expect(JSON.parse($2('#props').text())).toEqual({
      locale: 'nl-NL',
      locales,
      defaultLocale: 'en-US',
    })
    expect($2('#router-locale').text()).toBe('nl-NL')
    expect(JSON.parse($2('#router-locales').text())).toEqual(locales)
    expect(JSON.parse($2('#router-query').text())).toEqual({})
    expect($2('html').attr('lang')).toBe('nl-NL')
  })

  it('should load dynamic getServerSideProps page correctly SSR', async () => {
    const html = await renderViaHTTP(appPort, '/en-US/gssp/first')
    const $ = cheerio.load(html)

    expect(JSON.parse($('#props').text())).toEqual({
      locale: 'en-US',
      locales,
      params: {
        slug: 'first',
      },
      defaultLocale: 'en-US',
    })
    expect($('#router-locale').text()).toBe('en-US')
    expect(JSON.parse($('#router-locales').text())).toEqual(locales)
    expect(JSON.parse($('#router-query').text())).toEqual({ slug: 'first' })
    expect($('html').attr('lang')).toBe('en-US')

    const html2 = await renderViaHTTP(appPort, '/nl-NL/gssp/first')
    const $2 = cheerio.load(html2)

    expect(JSON.parse($2('#props').text())).toEqual({
      locale: 'nl-NL',
      locales,
      params: {
        slug: 'first',
      },
      defaultLocale: 'en-US',
    })
    expect($2('#router-locale').text()).toBe('nl-NL')
    expect(JSON.parse($2('#router-locales').text())).toEqual(locales)
    expect(JSON.parse($2('#router-query').text())).toEqual({ slug: 'first' })
    expect($2('html').attr('lang')).toBe('nl-NL')
  })

  it('should navigate to another page and back correctly with locale', async () => {
    const browser = await webdriver(appPort, '/en')

    await browser.eval('window.beforeNav = "hi"')

    await browser
      .elementByCss('#to-another')
      .click()
      .waitForElementByCss('#another')

    expect(await browser.elementByCss('#router-pathname').text()).toBe(
      '/another'
    )
    expect(await browser.elementByCss('#router-as-path').text()).toBe(
      '/another'
    )
    expect(await browser.elementByCss('#router-locale').text()).toBe('en')
    expect(
      JSON.parse(await browser.elementByCss('#router-locales').text())
    ).toEqual(locales)
    expect(JSON.parse(await browser.elementByCss('#props').text())).toEqual({
      locale: 'en',
      locales,
      defaultLocale: 'en-US',
    })
    expect(
      JSON.parse(await browser.elementByCss('#router-query').text())
    ).toEqual({})
    expect(await browser.eval('window.beforeNav')).toBe('hi')

    await browser.back().waitForElementByCss('#index')
    expect(await browser.eval('window.beforeNav')).toBe('hi')
    expect(await browser.elementByCss('#router-pathname').text()).toBe('/')
    expect(await browser.elementByCss('#router-as-path').text()).toBe('/')
  })

  it('should navigate to getStaticProps page and back correctly with locale', async () => {
    const browser = await webdriver(appPort, '/en')

    await browser.eval('window.beforeNav = "hi"')

    await browser.elementByCss('#to-gsp').click().waitForElementByCss('#gsp')

    expect(await browser.elementByCss('#router-pathname').text()).toBe('/gsp')
    expect(await browser.elementByCss('#router-as-path').text()).toBe('/gsp')
    expect(await browser.elementByCss('#router-locale').text()).toBe('en')
    expect(
      JSON.parse(await browser.elementByCss('#router-locales').text())
    ).toEqual(locales)
    expect(JSON.parse(await browser.elementByCss('#props').text())).toEqual({
      locale: 'en',
      locales,
      defaultLocale: 'en-US',
    })
    expect(
      JSON.parse(await browser.elementByCss('#router-query').text())
    ).toEqual({})
    expect(await browser.eval('window.beforeNav')).toBe('hi')

    await browser.back().waitForElementByCss('#index')
    expect(await browser.eval('window.beforeNav')).toBe('hi')
    expect(await browser.elementByCss('#router-pathname').text()).toBe('/')
    expect(await browser.elementByCss('#router-as-path').text()).toBe('/')
  })
}

describe('i18n Support', () => {
  // TODO: test with next export?
  describe('dev mode', () => {
    beforeAll(async () => {
      await fs.remove(join(appDir, '.next'))
      appPort = await findPort()
      app = await launchApp(appDir, appPort)
      // buildId = 'development'
    })
    afterAll(() => killApp(app))

    runTests(true)
  })

  describe('production mode', () => {
    beforeAll(async () => {
      await fs.remove(join(appDir, '.next'))
      await nextBuild(appDir)
      appPort = await findPort()
      app = await nextStart(appDir, appPort)
      buildPagesDir = join(appDir, '.next/server/pages')
      buildId = await fs.readFile(join(appDir, '.next/BUILD_ID'), 'utf8')
    })
    afterAll(() => killApp(app))

    runTests()
  })

  describe('serverless mode', () => {
    beforeAll(async () => {
      await fs.remove(join(appDir, '.next'))
      nextConfig.replace('// target', 'target')

      await nextBuild(appDir)
      appPort = await findPort()
      app = await nextStart(appDir, appPort)
      buildPagesDir = join(appDir, '.next/serverless/pages')
      buildId = await fs.readFile(join(appDir, '.next/BUILD_ID'), 'utf8')
    })
    afterAll(async () => {
      nextConfig.restore()
      await killApp(app)
    })

    it('should have correct props for blocking notFound', async () => {
      const serverFile = getPageFileFromPagesManifest(
        appDir,
        '/not-found/blocking-fallback/[slug]'
      )
      const appPort = await findPort()
      const mod = require(join(appDir, '.next/serverless', serverFile))

      const server = http.createServer(async (req, res) => {
        try {
          await mod.render(req, res)
        } catch (err) {
          res.statusCode = 500
          res.end('internal err')
        }
      })

      await new Promise((resolve, reject) => {
        server.listen(appPort, (err) => (err ? reject(err) : resolve()))
      })
      console.log('listening on', appPort)

      const res = await fetchViaHTTP(
        appPort,
        '/nl/not-found/blocking-fallback/first'
      )
      server.close()

      expect(res.status).toBe(404)

      const $ = cheerio.load(await res.text())
      const props = JSON.parse($('#props').text())

      expect($('#not-found').text().length > 0).toBe(true)
      expect(props).toEqual({
        is404: true,
        locale: 'nl',
        locales,
        defaultLocale: 'en-US',
      })
    })

    runTests()
  })

  describe('with localeDetection disabled', () => {
    beforeAll(async () => {
      await fs.remove(join(appDir, '.next'))
      nextConfig.replace('// localeDetection', 'localeDetection')

      await nextBuild(appDir)
      appPort = await findPort()
      app = await nextStart(appDir, appPort)
    })
    afterAll(async () => {
      nextConfig.restore()
      await killApp(app)
    })

    it('should have localeDetection in routes-manifest', async () => {
      const routesManifest = await fs.readJSON(
        join(appDir, '.next/routes-manifest.json')
      )

      expect(routesManifest.i18n).toEqual({
        localeDetection: false,
        locales: ['en-US', 'nl-NL', 'nl-BE', 'nl', 'fr-BE', 'fr', 'en'],
        defaultLocale: 'en-US',
        domains: [
          {
            http: true,
            domain: 'example.be',
            defaultLocale: 'nl-BE',
            locales: ['nl', 'nl-NL', 'nl-BE'],
          },
          {
            http: true,
            domain: 'example.fr',
            defaultLocale: 'fr',
            locales: ['fr-BE'],
          },
        ],
      })
    })

    it('should not detect locale from accept-language', async () => {
      const res = await fetchViaHTTP(
        appPort,
        '/',
        {},
        {
          redirect: 'manual',
          headers: {
            'accept-language': 'fr',
          },
        }
      )

      expect(res.status).toBe(200)
      const $ = cheerio.load(await res.text())
      expect($('html').attr('lang')).toBe('en-US')
      expect($('#router-locale').text()).toBe('en-US')
      expect(JSON.parse($('#router-locales').text())).toEqual(locales)
      expect($('#router-pathname').text()).toBe('/')
      expect($('#router-as-path').text()).toBe('/')
    })

    it('should set locale from detected path', async () => {
      for (const locale of locales) {
        const res = await fetchViaHTTP(
          appPort,
          `/${locale}`,
          {},
          {
            redirect: 'manual',
            headers: {
              'accept-language': 'en-US,en;q=0.9',
            },
          }
        )

        expect(res.status).toBe(200)
        const $ = cheerio.load(await res.text())
        expect($('html').attr('lang')).toBe(locale)
        expect($('#router-locale').text()).toBe(locale)
        expect(JSON.parse($('#router-locales').text())).toEqual(locales)
        expect($('#router-pathname').text()).toBe('/')
        expect($('#router-as-path').text()).toBe('/')
      }
    })
  })
})
