import { type Dispatch, type SetStateAction, useCallback, useEffect, useRef, useState } from 'react'

type UseControllableStateParams<T> = {
  prop?: T | undefined
  defaultProp?: T | undefined
  onChange?: ((value: T) => void) | undefined
}

// Controlled/uncontrolled state, mirroring @radix-ui/react-use-controllable-state:
// `prop` (when defined) takes precedence over internal state, and `onChange` fires
// on uncontrolled updates too. The returned setter is stable.
export function useControllableState<T>({
  prop,
  defaultProp,
  onChange,
}: UseControllableStateParams<T>): [T, Dispatch<SetStateAction<T>>] {
  const [uncontrolled, setUncontrolled] = useState<T>(defaultProp as T)
  const isControlled = prop !== undefined
  const value = (isControlled ? prop : uncontrolled) as T

  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  const prevRef = useRef(uncontrolled)
  useEffect(() => {
    if (!isControlled && prevRef.current !== uncontrolled) {
      onChangeRef.current?.(uncontrolled)
      prevRef.current = uncontrolled
    }
  }, [isControlled, uncontrolled])

  const setValue = useCallback<Dispatch<SetStateAction<T>>>(
    (next) => {
      if (isControlled) {
        const resolved = typeof next === 'function' ? (next as (prev: T) => T)(prop as T) : next
        if (resolved !== prop) onChangeRef.current?.(resolved)
      } else {
        setUncontrolled(next)
      }
    },
    [isControlled, prop]
  )

  return [value, setValue]
}
