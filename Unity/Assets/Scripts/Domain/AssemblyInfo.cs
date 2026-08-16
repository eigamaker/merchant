using System.Runtime.CompilerServices;

// Actor hit points, item locations and quick-slot bindings are deliberately not
// publicly settable: the services are the only sanctioned way to change them, and
// that is what keeps the invariants from leaking. Tests still need to arrange a
// mid-expedition situation — a wounded escort, a staggered enemy — without
// simulating the twenty turns that would produce it, so the test assembly is let
// in rather than widening the public surface for everyone.
[assembly: InternalsVisibleTo("Merchan.Domain.Tests")]
