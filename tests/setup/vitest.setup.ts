import '@testing-library/jest-dom/vitest'

// Radix/ui and future component tests may rely on browser APIs not present in jsdom.
if (typeof window !== 'undefined') {
  if (!window.matchMedia) {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: (query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }),
    })
  }

  if (!('ResizeObserver' in window)) {
    class ResizeObserverMock {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    ;(window as any).ResizeObserver = ResizeObserverMock
    ;(globalThis as any).ResizeObserver = ResizeObserverMock
  }
}

