export const builtInModels = {
  '@double-pendulum': { label: 'Double pendulum', path: 'pendulum/pendulum.xml' },
  '@cart-pole': { label: 'Cart-pole', path: 'models/cart-pole.xml' },
  '@spring-mass': { label: 'Spring-mass', path: 'models/spring-mass.xml' },
} as const

export function builtInModel(value: unknown) {
  return typeof value === 'string' && Object.hasOwn(builtInModels, value)
    ? builtInModels[value as keyof typeof builtInModels]
    : undefined
}
