=head1 Abbreviated pod
Some paragraph text.

=for comment
Hidden text here

#| before
sub documented($x) { $x } #= after

my ($h1, $h2) = q:to/A/, q:to/B/;
    first
    A
    second
    B
say $h1 ~ $h2;
my $v = 5 if True;
my %hh = %(a => 1, b => 2);
my $blk = { a => 1 };
my $i = 0; $i++; ++$i; $i--;
my @w = <a b c>;
say @w>>.uc;
for 1..3 { .say }
my $x = do if $i > 1 { 1 } else { 2 };
say $_ for @w;
.say for ^3;
class Dog { also does Positional; }
sub f($opt?, *@a, *%h, :$named!) { }
sub fc(|c) { }
sub g(\raw, Int :n(:$number) = 1) { }
sub k(::T $t, T $u) { }
say !$x, so $x, ?$x, +@w, ~$x, -$x;
X::AdHoc.new(payload => 'x').throw;
for $*IN.lines -> $line { }
say @*ARGS.elems, %*ENV<HOME>;
my $p = start { 42 };
say "a { "b $x" } c";
put 'x'; note 'y';
say 1 < 2 < 3;
my @r = @w
    .map({ $_ x 2 })
    .grep(*.chars > 1)
    .sort;
sub MAIN(Str $file, Bool :$verbose = False) { }
say 'abab' ~~ m:g/ab/;
my $rx = rx:i{ abc };
my $t = 'aaa'; $t ~~ s:g/a/b/;
if 'foo' ~~ /$<name>=(\w+)/ { say $<name>, $/<name>, $0 }
given 7 { when * > 5 { say 'big' } }
for @w { last unless $_ }
sub h($y) { return $y unless $y > 1; $y * 2 }
my %count;
%count{$_}++ for @w;
say %count.keys.sort.join(',');
my $s = sprintf('%05.2f', 3.14159);
say $s;
say [~] <a b c>;
say (1, 2, 3).map: * * 2;
my @matrix = [1, 2], [3, 4];
say @matrix[0][1];
say @matrix[0;1];
my $str = 'x' x 3;
my @rep = 0 xx 5;
my Int @ints = 1, 2;
say @ints.sum;
my ($first, *@rest) = 1, 2, 3;
say "Hi $first.";
say "{$first}th";
my $code = &say;
$code('called');
say 2 ** 10;
say 10 div 3, 10 mod 3, 10 % 3;
say 7 / 2;
say $i/2;
say sqrt 16;
