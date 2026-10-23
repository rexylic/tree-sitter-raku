#!/usr/bin/env raku
use v6.d;
use Test;

#`( embedded
    comment ) say 'after embedded';

=begin pod
=head1 NAME
Stress test
=end pod

#| Declarator doc for Point
class Point is export {
    has Int $.x is rw = 0;
    has Int $.y is rw = 0;
    has @!history;

    method new(Int:D $x, Int:D $y) {
        self.bless(:$x, :$y);
    }

    multi method distance(Point:D $other --> Num) {
        sqrt(($!x - $other.x) ** 2 + ($!y - $other.y) ** 2).Num
    }

    method !secret() { 42 }

    submethod BUILD(:$!x = 0, :$!y = 0) { }

    method Str { "Point($!x, $!y)" }
}

role Shape[::T] {
    method area(--> T) { ... }
}

grammar Calc {
    token TOP { <expr> }
    rule expr { <term>+ % <[+-]> }
    token term { \d+ | '(' <expr> ')' }
}

enum Color <red green blue>;
subset Positive of Int where * > 0;
constant PI2 = π * 2;

sub infix:<±>($a, $b) { ($a - $b, $a + $b) }

proto sub fib(Int $n) {*}
multi sub fib(0) { 0 }
multi sub fib(1) { 1 }
multi sub fib(Int $n where * > 1) { fib($n - 1) + fib($n - 2) }

my %h = a => 1, b => 2, :c(3), :!d;
my @list = 1..10;
my $sum = [+] @list;
my @squares = @list.map(* ** 2);
my @evens = @list.grep({ $_ %% 2 });
my @sorted = @list.sort: { $^b <=> $^a };
my $str = "Sum is $sum, first is @list[0] and h<a> is %h<a>, call: &fib(10). Email me@example.com.";
my $closure = "braces { $sum * 2 } done";
my $method = "Point is $sum.Str() today";
say $str;
say "tab\there\nnewline \x[41] \c[LATIN SMALL LETTER A]";
say 'single $not interpolated \' quote';
say q{curly {nested} quote};
say Q[raw [nested] $x];
say qq«french $sum »;
say <a b c>.elems;
say %h<a b>;
say @list[*-1];
say %h{'a'}:exists;

if $sum > 50 {
    say 'big';
} elsif $sum > 10 {
    say 'medium';
} else {
    say 'small';
}

unless $sum { die 'no sum' }

for @list -> $x {
    next if $x %% 2;
    last when 9;
    say $x;
}

for %h.kv -> $k, $v { say "$k => $v" }

my $i = 0;
while $i < 3 { $i++ }
until $i == 0 { $i-- }
loop (my $j = 0; $j < 3; $j++) { say $j }
repeat { $i++ } while $i < 5;

given $sum {
    when 55 { say 'fifty-five' }
    when Int { say 'int' }
    default { say 'other' }
}

with %h<a> -> $v { say $v } else { say 'none' }

my $result = try { die 'oops'; CATCH { default { say .message } } };

my @gathered = gather for ^5 { take $_ * 2 };
my $promise = start { sleep 0.1; 42 };
await $promise;

my $text = 'hello world';
if $text ~~ /wor(ld)/ {
    say ~$0;
}
$text ~~ s/world/there/;
$text ~~ tr/a..z/A..Z/;
my $m = $text ~~ m:i/ HELLO \s+ (\w+) /;
my $rx = rx{ \d+ };
say $text.subst(/o/, '0', :g);

my ($a, $b) = 1, 2;
($a, $b) = $b, $a;
my $ternary = $a > $b ?? 'a' !! 'b';
my $neg = -$a;
my $junction = 1 | 2 | 3;
say 1 == any(1, 2, 3);
say $a == 1 && $b == 2 || not $a;
my $range = 1 ..^ 10;
my @seq = 1, 2, 4 ... 256;
my @zipped = @list Z @squares;
say @list».Str;
say (1, 2, 3).join(', ');
printf "%d items\n", @list.elems;
my &code = &fib;
say code(5);
my $pointy = -> $x, $y = 2 { $x + $y };
say $pointy(1);
my $anon = sub ($x) { $x * 2 };
$a += 1;
$str ~= '!';
my Int $typed = 5;
my Str @strs = <x y z>;
say $*OUT.^name;
say $?FILE;
my \sigilless = 10;
say sigilless + 1;
say 0x1F + 0b101 + 0o17 + 1_000 + 3.14 + 1e10 + 2i + <1/3>;
say :16<FF>;

BEGIN { say 'compile time' }
END { say 'done' }

my $heredoc = q:to/EOT/;
    Some text with $no interpolation
    EOT

my $hd2 = qq:to/END/.lines.elems;
    interpolated $sum
    END

say $heredoc ~ $hd2;
react {
    whenever Supply.interval(1) -> $t { done if $t > 2 }
}
is 1, 1, 'test passes';
done-testing;
