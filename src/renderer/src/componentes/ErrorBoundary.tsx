import { Component, type ReactNode } from 'react'
import { AlertTriangle } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

interface ErrorBoundaryProps {
  children: ReactNode
}

interface ErrorBoundaryState {
  hasError: boolean
  error: Error | null
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('ErrorBoundary caught an error:', error, errorInfo)
  }

  handleReload = () => {
    this.setState({ hasError: false, error: null })
    window.location.reload()
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-screen items-center justify-center p-6">
          <Card className="max-w-md">
            <CardContent className="flex flex-col items-center py-10 text-center">
              <div className="mb-4 flex size-16 items-center justify-center rounded-full bg-destructive/10">
                <AlertTriangle className="size-8 text-destructive" />
              </div>
              <h2 className="text-lg font-semibold text-foreground">
                Algo deu errado
              </h2>
              <p className="mt-2 text-sm text-muted-foreground">
                Ocorreu um erro inesperado. Tente recarregar a pagina.
              </p>
              {this.state.error && (
                <p className="mt-3 rounded bg-muted px-3 py-1.5 font-mono text-xs text-muted-foreground">
                  {this.state.error.message}
                </p>
              )}
              <Button className="mt-6" onClick={this.handleReload}>
                Recarregar pagina
              </Button>
            </CardContent>
          </Card>
        </div>
      )
    }

    return this.props.children
  }
}
