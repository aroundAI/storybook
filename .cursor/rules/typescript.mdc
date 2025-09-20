---
description: 
globs: *.ts,*.tsx
alwaysApply: false
---
# Typescript

- Write clean, clear, well-designed, explicit Typescript
- Make sure types are validated strictly
- Use implicit type inference, unless impossible
- Consider using classes for server-side services, but export a function instead of the class

```tsx
// service.ts
class UserService {
  getUser(id: number) {
    // ... implementation ...
    return { id, name: 'Example User' };
  }
}

export function createUserService() {
    return new UserService();
}
```

- Follow the Single Responsibility Principle (SRP). Each module/function/class should have one reason to change.
- Favor composition over inheritance.
- Handle errors gracefully using try/catch and appropriate error types.
- Keep functions short and focused.
- Use descriptive names for variables, functions, and classes.
- Avoid unnecessary complexity.
- Avoid using `any` type as much as possible. If necessary, use `unknown`
- Use enums only when appropriate. Consider union types of string literals as an alternative.
- Be aware of performance implications of your code.

