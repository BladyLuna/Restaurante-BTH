import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Los tests de auth hacen varios argon2 por caso (64 MB, ~300 ms cada uno)
    // y el login prueba el PIN contra cada usuario activo. Con el default de
    // 5 s se cortan a mitad.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // Secuencial: los tests de integración comparten la base y se pisan entre
    // archivos si corren en paralelo.
    fileParallelism: false,
  },
});
