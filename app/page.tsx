import Link from "next/link";

export default function Home() {
  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-black px-6 py-12">
      <main className="w-full max-w-2xl text-center">
        <h1 className="text-6xl font-semibold tracking-tight text-white sm:text-7xl">
          StudyFlow AI
        </h1>
        <p className="mx-auto mt-4 max-w-xl text-sm leading-6 text-zinc-400 sm:text-base">
          Organiza tus sesiones de estudio y tus apuntes PDF en un solo lugar.
        </p>

        <div className="mt-10">
          <Link
            href="/login"
            className="inline-flex h-11 items-center justify-center rounded-xl bg-zinc-100 px-8 text-sm font-semibold text-zinc-900 transition hover:bg-white cursor-pointer"
          >
            Acceder
          </Link>
        </div>
      </main>
    </div>
  );
}
