import Alert from '@mui/material/Alert'
import Container from '@mui/material/Container'

// Where the browser lands after the token has been stripped from the address
// bar. Reloading here has nothing to act on, which is the point.
export default function FreigabeOhneToken() {
  return (
    <Container maxWidth="sm" sx={{ py: 5 }}>
      <Alert severity="info">
        Diese Seite braucht den Link aus Ihrer Nachricht. Bitte oeffnen Sie ihn erneut.
      </Alert>
    </Container>
  )
}
