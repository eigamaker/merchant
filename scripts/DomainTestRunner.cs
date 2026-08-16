// Minimal NUnit runner for the engine-free Merchan.Domain assembly.
//
// Unity holds an exclusive lock on Unity/Library while the editor is open, so
// `unity-tests.ps1` cannot run at the same time as a normal editing session.
// Merchan.Domain deliberately has noEngineReferences, which means the very same
// test sources can be compiled and executed against a plain .NET runtime. This
// runner exists to make that loop available; the Unity Test Runner remains the
// authority, and every test that passes here must also pass there.
//
// Compiled and invoked by scripts/domain-tests.ps1. It is outside Assets/ so
// Unity never compiles it.

using System;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using NUnit.Framework;

internal static class DomainTestRunner
{
    private sealed class Failure
    {
        public string Name;
        public string Message;
    }

    public static int Main(string[] args)
    {
        var assemblies = args.Select(Assembly.LoadFrom).ToList();
        if (assemblies.Count == 0)
        {
            Console.Error.WriteLine("usage: DomainTestRunner <test-assembly.dll> [...]");
            return 2;
        }

        var passed = 0;
        var skipped = 0;
        var failures = new List<Failure>();

        foreach (var assembly in assemblies)
        foreach (var fixture in assembly.GetTypes().Where(HasTests).OrderBy(type => type.FullName))
        {
            var setUp = MethodsWith<SetUpAttribute>(fixture);
            var tearDown = MethodsWith<TearDownAttribute>(fixture);

            foreach (var test in MethodsWith<TestAttribute>(fixture).Concat(MethodsWith<TestCaseAttribute>(fixture)).Distinct().OrderBy(m => m.Name))
            foreach (var arguments in ArgumentSets(test))
            {
                var name = $"{fixture.FullName}.{test.Name}{Describe(arguments)}";
                if (test.GetCustomAttributes(typeof(IgnoreAttribute), true).Length > 0)
                {
                    skipped++;
                    continue;
                }

                try
                {
                    var instance = Activator.CreateInstance(fixture);
                    foreach (var method in setUp) method.Invoke(instance, null);
                    try
                    {
                        test.Invoke(instance, arguments);
                        passed++;
                    }
                    finally
                    {
                        foreach (var method in tearDown) method.Invoke(instance, null);
                    }
                }
                catch (TargetInvocationException exception)
                {
                    failures.Add(new Failure { Name = name, Message = Describe(exception.InnerException) });
                }
                catch (Exception exception)
                {
                    failures.Add(new Failure { Name = name, Message = Describe(exception) });
                }
            }
        }

        foreach (var failure in failures)
        {
            Console.WriteLine();
            Console.WriteLine("FAILED " + failure.Name);
            foreach (var line in failure.Message.Split('\n'))
                Console.WriteLine("  " + line.TrimEnd());
        }

        Console.WriteLine();
        Console.WriteLine($"total={passed + failures.Count + skipped} passed={passed} failed={failures.Count} skipped={skipped}");
        return failures.Count == 0 ? 0 : 1;
    }

    private static bool HasTests(Type type)
    {
        return !type.IsAbstract
            && type.GetConstructor(Type.EmptyTypes) != null
            && (MethodsWith<TestAttribute>(type).Any() || MethodsWith<TestCaseAttribute>(type).Any());
    }

    private static IEnumerable<MethodInfo> MethodsWith<TAttribute>(Type type) where TAttribute : Attribute
    {
        return type.GetMethods(BindingFlags.Public | BindingFlags.Instance | BindingFlags.DeclaredOnly)
            .Where(method => method.GetCustomAttributes(typeof(TAttribute), true).Length > 0);
    }

    /// <summary>One entry per [TestCase], or a single parameterless invocation.</summary>
    private static IEnumerable<object[]> ArgumentSets(MethodInfo test)
    {
        var cases = test.GetCustomAttributes(typeof(TestCaseAttribute), true).Cast<TestCaseAttribute>().ToList();
        if (cases.Count == 0) return new[] { (object[])null };
        return cases.Select(entry => entry.Arguments);
    }

    private static string Describe(object[] arguments)
    {
        return arguments == null || arguments.Length == 0 ? "" : "(" + string.Join(", ", arguments.Select(a => a?.ToString() ?? "null")) + ")";
    }

    private static string Describe(Exception exception)
    {
        if (exception == null) return "(no exception detail)";
        // An assertion failure already reads well on its own; anything else is a
        // real crash and needs the stack trace to locate.
        return exception is AssertionException
            ? exception.Message
            : exception.ToString();
    }
}
