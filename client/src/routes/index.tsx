import { useChrome } from '@/state'
import { createFileRoute, Link } from '@tanstack/react-router'

export const Route = createFileRoute('/')({ component: Home })

function Home() {
  const chrome = useChrome()
  if (!chrome) return <main className='p-4'>Connecting…</main>
  return (
    <main className='flex flex-col gap-4 p-4'>
      {chrome.projects.map((project) => (
        <section key={project.id}>
          <h2>{project.title}</h2>
          <ul>
            {chrome.threads
              .filter((thread) => thread.projectId === project.id && !thread.archived)
              .map((thread) => (
                <li key={thread.id}>
                  <Link to='/threads/$threadId' params={{ threadId: thread.id }}>
                    {thread.title}
                  </Link>
                </li>
              ))}
          </ul>
        </section>
      ))}
    </main>
  )
}
